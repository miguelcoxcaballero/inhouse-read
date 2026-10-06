import { expect,test } from '@playwright/test';

const SHELF_KEY = 'inhouse-read-shelf-type';
const PLANTS_KEY = 'inhouse-read-shelf-plants';
// The page is hidden at once, but the browser can only report it once the main thread
// is free: the software renderer links a new lamp's shaders in one long task (~8 s).
const CLOSE_TIMEOUT = { timeout:30_000 };
test.use({ viewport:{ width:390,height:844 },hasTouch:true,isMobile:true,deviceScaleFactor:1 });
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (localStorage.getItem('inhouse-read-shelf-view') === null)
      localStorage.setItem('inhouse-read-shelf-view','isometric');
    if (localStorage.getItem('inhouse-read-shelf-plants') === null)
      localStorage.setItem('inhouse-read-shelf-plants','[]');
  });
  await page.goto(process.env.IHR_TEST_URL || '/');
  await expect(page.locator('.ihr-bookshelf-scene')).toHaveAttribute('data-animating','false');
});

async function openCatalog(page) {
  await page.getByRole('button',{ name:/Abrir catálogo IKEA/ }).click();
  const dialog = page.getByTestId('plant-catalog');
  await expect(dialog).toBeVisible();
  await dialog.evaluate(node => Promise.all(node.getAnimations().map(animation => animation.finished.catch(() => {}))));
  return dialog;
}

async function assertFits(dialog) {
  const measurements = await dialog.evaluate(node => {
    const rect = node.getBoundingClientRect();
    const visible = [...node.querySelectorAll('button,fieldset,legend,.ihr-plant-catalog__drawing')]
      .filter(child => !child.closest('[hidden]'))
      .map(child => ({ label:child.getAttribute('aria-label') || child.textContent,rect:child.getBoundingClientRect().toJSON() }));
    return { rect:rect.toJSON(),width:node.clientWidth,height:node.clientHeight,
      scrollWidth:node.scrollWidth,scrollHeight:node.scrollHeight,visible };
  });
  expect(measurements.scrollHeight).toBeLessThanOrEqual(measurements.height + 1);
  expect(measurements.scrollWidth).toBeLessThanOrEqual(measurements.width + 1);
  for (const item of measurements.visible) {
    expect(item.rect.left,item.label).toBeGreaterThanOrEqual(measurements.rect.left - 1);
    expect(item.rect.right,item.label).toBeLessThanOrEqual(measurements.rect.right + 1);
    expect(item.rect.top,item.label).toBeGreaterThanOrEqual(measurements.rect.top - 1);
    expect(item.rect.bottom,item.label).toBeLessThanOrEqual(measurements.rect.bottom + 1);
  }
}

test('las dos páginas caben sin scroll en móvil pequeño, móvil y horizontal y reutilizan los previews suspendidos',async ({ page },testInfo) => {
  test.setTimeout(120_000);
  const errors = []; page.on('pageerror',error => errors.push(error.message));
  // Studios are created lazily and retained; only the selected page may draw.
  // Use the existing counters and DOM identity, without adding rendering probes.
  const assertRetained = async (dialog,count) => {
    await expect(dialog.locator('canvas')).toHaveCount(count);
    expect(await dialog.evaluate(node => {
      const current = [...node.querySelectorAll('canvas')];
      const retained = window.__shelfTypeCanvases || [];
      const same = retained.every((canvas,index) => canvas === current[index]);
      window.__shelfTypeCanvases = current;
      return same;
    })).toBe(true);
  };
  for (const [index,viewport] of [{ width:320,height:568 },{ width:390,height:844 },{ width:844,height:390 }].entries()) {
    await page.setViewportSize(viewport);
    await expect(page.locator('.ihr-bookshelf-scene')).toHaveAttribute('data-animating','false');
    const dialog = await openCatalog(page);
    await assertFits(dialog);
    await assertRetained(dialog,index === 0 ? 1 : 2);
    await expect(dialog.locator('canvas:visible')).toHaveCount(1);
    await expect(dialog.locator('[data-preview-active="true"]')).toHaveCount(1);
    const plantDrawing = dialog.locator('.ihr-plant-catalog__drawing:not(.ihr-plant-catalog__shelf-drawing):not(.ihr-plant-catalog__lamp-drawing)');
    await expect(plantDrawing).toHaveAttribute('data-preview-active','true');
    await dialog.getByRole('button',{ name:'Estanterías',exact:true }).click();
    await expect(dialog).toHaveAttribute('data-catalog-page','shelves');
    await expect(plantDrawing).toHaveAttribute('data-preview-active','false');
    const suspendedPlant = await plantDrawing.getAttribute('data-render-count');
    await dialog.locator('[data-catalog-shelf="baggebo"]').click();
    await expect(dialog.locator('.ihr-plant-catalog__shelf-drawing')).toHaveAttribute('data-renderer','three-mesh');
    await expect(dialog.locator('.ihr-plant-catalog__shelf-drawing')).toHaveAttribute('data-shelf-type','baggebo');
    await expect(dialog.locator('.ihr-plant-catalog__shelf-dimensions')).toHaveText('60 × 25 × 116 cm');
    const previewBounds = await dialog.locator('.ihr-plant-catalog__shelf-drawing').boundingBox();
    expect(previewBounds.height).toBeGreaterThan(viewport.height > 480 ? 200 : 100);
    await assertRetained(dialog,2);
    await expect(dialog.locator('canvas:visible')).toHaveCount(1);
    await expect(dialog.locator('[data-preview-active="true"]')).toHaveCount(1);
    await expect(dialog.locator('.ihr-plant-catalog__shelf-drawing')).toHaveAttribute('data-preview-active','true');
    await assertFits(dialog);
    await testInfo.attach(`catalogo-baggebo-${viewport.width}x${viewport.height}`,{ body:await dialog.screenshot(),contentType:'image/png' });
    expect(await plantDrawing.getAttribute('data-render-count')).toBe(suspendedPlant);
    await dialog.getByRole('button',{ name:'Plantas y macetas',exact:true }).click();
    await assertRetained(dialog,2);
    await expect(dialog.locator('canvas:visible')).toHaveCount(1);
    await expect(plantDrawing).toHaveAttribute('data-preview-active','true');
    await expect(dialog.locator('.ihr-plant-catalog__shelf-drawing')).toHaveAttribute('data-preview-active','false');
    await dialog.getByRole('button',{ name:'Cerrar catálogo' }).click();
    await expect(dialog).toBeHidden(CLOSE_TIMEOUT);
    await expect(dialog.locator('canvas:visible')).toHaveCount(0);
    await expect(dialog.locator('[data-preview-active="true"]')).toHaveCount(0);
    await assertRetained(dialog,2);
    const suspended = await dialog.locator('[data-renderer="three-mesh"]').evaluateAll(nodes => nodes.map(node => node.dataset.renderCount));
    await page.waitForTimeout(250);
    expect(await dialog.locator('[data-renderer="three-mesh"]').evaluateAll(nodes => nodes.map(node => node.dataset.renderCount))).toEqual(suspended);
  }
  expect(errors).toEqual([]);
});

test('elegir BAGGEBO conserva libros y plantas al recargar y permite recuperar la estantería de madera',async ({ page },testInfo) => {
  test.setTimeout(180_000);
  const errors = []; page.on('pageerror',error => errors.push(error.message));
  await page.locator('#file-picker').setInputFiles('tests/e2e/fixtures/tiny.pdf');
  await expect(page.locator('.pdf-page-canvas')).toBeVisible();
  await page.getByRole('button',{ name:'Volver a la estantería' }).click();
  await expect(page.locator('.ihr-flyout')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.ihr-bookshelf-scene')).toHaveAttribute('data-animating','false');
  let dialog = await openCatalog(page);
  await dialog.locator('[data-catalog-plant="monstera"]').click();
  await dialog.getByRole('button',{ name:'Añadir', exact:true }).click();
  await expect(dialog).toBeHidden(CLOSE_TIMEOUT);
  await expect(page.locator('.ihr-plant')).toHaveCount(1);
  const originalPlant = await page.evaluate(key => JSON.parse(localStorage.getItem(key))[0],PLANTS_KEY);
  const originalBookId = await page.locator('.ihr-spine').getAttribute('data-book-id');
  dialog = await openCatalog(page);
  await dialog.getByRole('button',{ name:'Estanterías',exact:true }).click();
  await dialog.locator('[data-catalog-shelf="baggebo"]').click();
  await dialog.getByRole('button',{ name:'Usar', exact:true }).click();
  await expect(dialog).toBeHidden(CLOSE_TIMEOUT);
  await expect(page.locator('.ihr-bookshelf-scene')).toHaveAttribute('data-shelf-type','baggebo');
  expect(await page.evaluate(key => localStorage.getItem(key),SHELF_KEY)).toBe('baggebo');
  await expect(page.locator('.ihr-spine')).toHaveCount(1);
  await expect(page.locator('.ihr-spine')).toHaveAttribute('data-book-id',originalBookId);
  await expect(page.locator('.ihr-plant')).toHaveAttribute('data-object-id',originalPlant.key);
  await expect(page.locator('.ihr-bookshelf-scene')).toHaveAttribute('data-animating','false');
  await testInfo.attach('baggebo-con-libro-y-planta',{ body:await page.screenshot(),contentType:'image/png' });
  await page.reload();
  await expect(page.locator('.ihr-bookshelf-scene')).toHaveAttribute('data-shelf-type','baggebo');
  await expect(page.locator('.ihr-spine')).toHaveAttribute('data-book-id',originalBookId);
  await expect(page.locator('.ihr-plant')).toHaveAttribute('data-object-id',originalPlant.key);
  dialog = await openCatalog(page);
  await dialog.getByRole('button',{ name:'Estanterías',exact:true }).click();
  await expect(dialog.locator('[data-catalog-shelf="baggebo"]')).toHaveAttribute('aria-pressed','true');
  await dialog.locator('[data-catalog-shelf="walnut"]').click();
  await dialog.getByRole('button',{ name:'Usar', exact:true }).click();
  await expect(page.locator('.ihr-bookshelf-scene')).toHaveAttribute('data-shelf-type','walnut');
  await expect(page.locator('.ihr-spine')).toHaveAttribute('data-book-id',originalBookId);
  await expect(page.locator('.ihr-plant')).toHaveAttribute('data-object-id',originalPlant.key);
  expect(errors).toEqual([]);
});
