import { expect,test } from '@playwright/test';

const LAMPS_KEY = 'inhouse-read-shelf-lamps';
test.use({ viewport:{ width:390,height:844 },hasTouch:true,isMobile:true,deviceScaleFactor:1 });
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (localStorage.getItem('inhouse-read-shelf-view') === null)
      localStorage.setItem('inhouse-read-shelf-view','isometric');
    if (localStorage.getItem('inhouse-read-shelf-plants') === null)
      localStorage.setItem('inhouse-read-shelf-plants','[]');
    if (localStorage.getItem('inhouse-read-shelf-lamps') === null)
      localStorage.setItem('inhouse-read-shelf-lamps','[]');
  });
  await page.goto(process.env.IHR_TEST_URL || '/');
  await expect(page.locator('.ihr-bookshelf-scene')).toHaveAttribute('data-animating','false');
});

async function openLights(page) {
  await page.getByRole('button',{ name:/Abrir catálogo IKEA/ }).click();
  const dialog = page.getByTestId('plant-catalog');
  await expect(dialog).toBeVisible();
  await dialog.evaluate(node => Promise.all(node.getAnimations().map(animation => animation.finished.catch(() => {}))));
  await dialog.getByRole('button',{ name:'Iluminación',exact:true }).click();
  await expect(dialog).toHaveAttribute('data-catalog-page','lights');
  return dialog;
}
const savedLamps = page => page.evaluate(key => JSON.parse(localStorage.getItem(key)),LAMPS_KEY);

async function assertFits(dialog) {
  const layout = await dialog.evaluate(node => {
    const body = node.querySelector('.ihr-plant-catalog__body:not([hidden])'), rect = body.getBoundingClientRect();
    return {
      width:node.clientWidth,scrollWidth:node.scrollWidth,height:node.clientHeight,scrollHeight:node.scrollHeight,
      bodyHeight:body.clientHeight,bodyScrollHeight:body.scrollHeight,
      controls:[...body.querySelectorAll('button')].map(button => {
        const bounds = button.getBoundingClientRect();
        return bounds.left >= rect.left - 1 && bounds.right <= rect.right + 1 && bounds.top >= rect.top - 1 && bounds.bottom <= rect.bottom + 1
          && button.contains(document.elementFromPoint(bounds.x + bounds.width / 2,bounds.y + bounds.height / 2));
      })
    };
  });
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.width + 1);
  expect(layout.scrollHeight).toBeLessThanOrEqual(layout.height + 1);
  expect(layout.bodyScrollHeight).toBeLessThanOrEqual(layout.bodyHeight + 1);
  expect(layout.controls.every(Boolean)).toBe(true);
}

test('las tres lámparas tienen preview 3D con luz cálida y caben sin scroll en móvil y horizontal',async ({ page },testInfo) => {
  test.setTimeout(120_000);
  const errors = []; page.on('pageerror',error => errors.push(error.message));
  for (const viewport of [{ width:320,height:568 },{ width:390,height:844 },{ width:844,height:390 }]) {
    await page.setViewportSize(viewport);
    const dialog = await openLights(page), preview = dialog.locator('.ihr-plant-catalog__lamp-drawing');
    await expect(dialog.locator('[data-catalog-lamp]')).toHaveCount(3);
    await expect(dialog.locator('.ihr-plant-catalog__page-number')).toHaveText('03 / 03');
    for (const [lampId,mount] of [['mittled','undershelf'],['tarnaby','standing'],['tripod','standing']]) {
      await dialog.locator(`[data-catalog-lamp="${lampId}"]`).click();
      await expect(preview).toHaveAttribute('data-renderer','three-mesh');
      await expect(preview).toHaveAttribute('data-lamp-id',lampId);
      await expect(preview).toHaveAttribute('data-mount',mount);
      await expect(preview).toHaveAttribute('data-warm-kelvin','2700');
      await expect(preview).toHaveAttribute('data-light-emitter','warm-physical');
      await expect(preview.locator('canvas')).toBeVisible();
      await expect(preview.locator('svg,img')).toHaveCount(0);
      await expect(dialog.locator('canvas')).toHaveCount(1);
      await assertFits(dialog);
      if (viewport.width === 390)
        await testInfo.attach(`lampara-${lampId}-3d-movil`,{ body:await dialog.screenshot(),contentType:'image/png' });
    }
    await dialog.getByRole('button',{ name:'Estanterías',exact:true }).click();
    await expect(preview.locator('canvas')).toHaveCount(0);
    await expect(dialog.locator('canvas')).toHaveCount(1);
    await dialog.getByRole('button',{ name:'Cerrar catálogo' }).click();
    await expect(dialog.locator('canvas')).toHaveCount(0);
  }
  expect(errors).toEqual([]);
});

test('añadir cada diseño conserva las tres lámparas al recargar y al cambiar a BAGGEBO',async ({ page },testInfo) => {
  test.setTimeout(150_000);
  const errors = []; page.on('pageerror',error => errors.push(error.message));
  for (const [index,lampId] of ['mittled','tarnaby','tripod'].entries()) {
    const dialog = await openLights(page);
    await dialog.locator(`[data-catalog-lamp="${lampId}"]`).click();
    await dialog.getByRole('button',{ name:'Añadir', exact:true }).click();
    await expect(dialog).toBeHidden();
    await expect(page.locator('.ihr-lamp')).toHaveCount(index + 1);
    await expect(page.locator(`.ihr-lamp[data-lamp-id="${lampId}"]`)).toHaveCount(1);
  }
  const lamps = await savedLamps(page);
  expect(lamps).toHaveLength(3);
  expect(lamps.map(lamp => lamp.lampId)).toEqual(['mittled','tarnaby','tripod']);
  expect(lamps.every(lamp => Number.isFinite(lamp.shelf) && Number.isFinite(lamp.x))).toBe(true);
  await expect(page.locator('.ihr-bookshelf-scene')).toHaveAttribute('data-animating','false');
  await testInfo.attach('tres-lamparas-en-estanteria',{ body:await page.screenshot(),contentType:'image/png' });
  await page.reload();
  await expect(page.locator('.ihr-lamp')).toHaveCount(3);
  expect(await savedLamps(page)).toEqual(lamps);
  const dialog = await openLights(page);
  await dialog.getByRole('button',{ name:'Estanterías',exact:true }).click();
  await dialog.locator('[data-catalog-shelf="baggebo"]').click();
  await dialog.getByRole('button',{ name:'Usar', exact:true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('.ihr-bookshelf-scene')).toHaveAttribute('data-shelf-type','baggebo');
  await expect(page.locator('.ihr-lamp')).toHaveCount(3);
  expect((await savedLamps(page)).map(lamp => lamp.lampId)).toEqual(['mittled','tarnaby','tripod']);
  await page.reload();
  await expect(page.locator('.ihr-lamp')).toHaveCount(3);
  expect(errors).toEqual([]);
});
