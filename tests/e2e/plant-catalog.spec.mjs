import { expect, test } from '@playwright/test';

const PLANTS_KEY = 'inhouse-read-shelf-plants';
const CATALOG_NAME = 'Abrir catálogo IKEA de plantas y macetas';
test.use({ viewport:{ width:390,height:844 },hasTouch:true,isMobile:true,deviceScaleFactor:1 });
test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion:'no-preference' });
  await page.addInitScript(() => {
    if (localStorage.getItem('inhouse-read-shelf-plants') === null)
      localStorage.setItem('inhouse-read-shelf-plants','[]');
    if (localStorage.getItem('inhouse-read-shelf-view') === null)
      localStorage.setItem('inhouse-read-shelf-view','spine');
  });
  await page.goto(process.env.IHR_TEST_URL || '/');
  await expect(page.locator('.ihr-bookshelf-scene')).toBeVisible();
  await expect(page.locator('.ihr-bookshelf-scene')).toHaveAttribute('data-animating','false');
});

async function openCatalog(page) {
  await page.getByRole('button',{ name:'Vista isométrica, libros de lado' }).click();
  await expect(page.locator('.ihr-bookshelf-scene')).toHaveAttribute('data-view-progress','1');
  await expect(page.locator('.ihr-bookshelf-scene')).toHaveAttribute('data-animating','false');
  const catalog = page.getByRole('button',{ name:CATALOG_NAME });
  await expect(catalog).toBeVisible();
  await expect(catalog).toHaveAttribute('data-catalog3d','true');
  await catalog.click();
  await expect(page.getByTestId('plant-catalog')).toBeVisible();
  await page.getByTestId('plant-catalog').evaluate(node => Promise.all(
    node.getAnimations().map(animation => animation.finished.catch(() => {}))
  ));
  return page.getByTestId('plant-catalog');
}
const savedPlants = page => page.evaluate(key => JSON.parse(localStorage.getItem(key)),PLANTS_KEY);

test('una planta junto a un libro fino no tapa su zona táctil al girar o recargar la estantería',async ({ page }) => {
  test.setTimeout(90_000);
  const errors = []; page.on('pageerror',error => errors.push(error.message));
  // Import the real landscape cover. A portrait placeholder puts the book's
  // center above the foliage and does not expose this interception regression.
  await page.locator('#file-picker').setInputFiles('tests/e2e/fixtures/tiny.pdf');
  await expect(page.locator('.pdf-page-canvas')).toBeVisible();
  await page.getByRole('button',{ name:'Volver a la estantería' }).click();
  await expect(page.locator('.ihr-flyout')).toHaveCount(0);
  await page.evaluate(() => {
    localStorage.setItem('inhouse-read-shelf-plants',JSON.stringify([
      { key:'plant:narrow-neighbor',seed:'empty-shelf-0',catalogId:'sansevieria',variant:'sansevieria',
        potId:'muskot',width:42,height:124,shelf:0,x:.2032520325203252 }
    ]));
  });
  await page.reload();
  const canvas = page.locator('.ihr-bookshelf-scene');
  const spine = page.locator('.ihr-spine').first();
  await expect(spine).toBeVisible();
  await page.getByRole('button',{ name:'Vista isométrica, libros de lado' }).click();
  await expect(canvas).toHaveAttribute('data-view-progress','1');
  await page.reload();
  await expect(canvas).toHaveAttribute('data-view-progress','1');
  await expect(canvas).toHaveAttribute('data-animating','false');
  expect(await spine.evaluate(node => {
    const box = node.getBoundingClientRect();
    return node.contains(document.elementFromPoint(box.x + box.width / 2,box.y + box.height / 2));
  })).toBe(true);
  await spine.click();
  await expect(page.getByRole('button',{ name:/Toca para leer/ })).toBeVisible();
  await page.getByRole('button',{ name:'Cerrar',exact:true }).click();
  await expect(page.locator('.ihr-flyout')).toHaveCount(0);
  await expect(canvas).toHaveAttribute('data-animating','false');
  const plant = page.locator('.ihr-plant[data-object-id="plant:narrow-neighbor"]');
  const pot = await plant.boundingBox();
  await page.mouse.move(pot.x + pot.width / 2,pot.y + pot.height * .88);
  await page.mouse.down(); await page.waitForTimeout(450);
  await expect(plant).toHaveClass(/is-lifted/);
  await page.mouse.up();
  await expect(page.locator('.ihr-bookshelf')).not.toHaveClass(/is-arranging/);
  await expect(canvas).toHaveAttribute('data-animating','false');
  await expect(page.locator('.ihr-plant')).toHaveCount(1);
  await expect(spine).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('el catálogo está pegado al lateral 3D, sólo aparece en isométrica y añade la combinación elegida de forma persistente',async ({ page },testInfo) => {
  test.setTimeout(90_000);
  const errors = []; page.on('pageerror',error => errors.push(error.message));
  await expect(page.locator('.ihr-shelf-catalog')).toBeHidden();
  await expect(page.locator('.ihr-plant')).toHaveCount(0);
  const dialog = await openCatalog(page);
  await expect(dialog.locator('[data-catalog-plant]')).toHaveCount(8);
  await expect(dialog.locator('[data-catalog-pot]')).toHaveCount(4);
  await expect(dialog.locator('img')).toHaveCount(0);
  await dialog.locator('[data-catalog-plant="monstera"]').click();
  await dialog.locator('[data-catalog-pot="gradvis"]').click();
  await expect(dialog.locator('.ihr-plant-catalog__caption h3')).toHaveText('MONSTERA DELICIOSA');
  await expect(dialog.locator('.ihr-plant-catalog__pot-name')).toHaveText('GRADVIS');
  await testInfo.attach('catalogo-ikea-en-movil',{ body:await dialog.screenshot(),contentType:'image/png' });
  await dialog.getByRole('button',{ name:'Añadir a la estantería' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('.ihr-plant')).toHaveCount(1);
  await expect(page.locator('.ihr-plant')).toHaveAttribute('data-catalog-id','monstera');
  await expect(page.locator('.ihr-plant')).toHaveAttribute('data-pot-id','gradvis');
  const plants = await savedPlants(page);
  expect(plants).toHaveLength(1);
  expect(plants[0]).toMatchObject({ catalogId:'monstera',potId:'gradvis',variant:'monstera',width:92,height:126 });
  expect(Number.isFinite(plants[0].x)).toBe(true);
  expect(Number.isFinite(plants[0].shelf)).toBe(true);
  await expect(page.locator('.ihr-bookshelf-scene')).toHaveAttribute('data-animating','false');
  await page.reload();
  await expect(page.locator('.ihr-plant')).toHaveCount(1);
  await expect(page.locator('.ihr-plant')).toHaveAttribute('data-object-id',plants[0].key);
  expect(await savedPlants(page)).toEqual(plants);
  await page.getByRole('button',{ name:'Vista de canto' }).click();
  await expect(page.locator('.ihr-bookshelf-scene')).toHaveAttribute('data-view-progress','0');
  await expect(page.locator('.ihr-shelf-catalog')).toBeHidden();
  await expect(page.locator('.ihr-bookshelf-scene')).toHaveAttribute('data-catalog-visible','false');
  expect(errors).toEqual([]);
});

test('el folleto sigue siendo usable en 320 px, mantiene el botón de añadir visible y devuelve el foco al cerrarlo',async ({ page },testInfo) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width:320,height:568 });
  const dialog = await openCatalog(page);
  const bounds = await dialog.boundingBox();
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.y).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(321);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(569);
  const add = dialog.getByRole('button',{ name:'Añadir a la estantería' });
  const footerBounds = await add.boundingBox();
  expect(footerBounds.y + footerBounds.height).toBeLessThanOrEqual(568);
  await dialog.locator('[data-catalog-plant="hedera"]').click();
  await dialog.locator('[data-catalog-pot="akerbar"]').click();
  await expect(dialog.locator('[data-catalog-plant="hedera"]')).toHaveAttribute('aria-pressed','true');
  await expect(dialog.locator('[data-catalog-pot="akerbar"]')).toHaveAttribute('aria-pressed','true');
  const overflow = await dialog.evaluate(node => ({ width:node.scrollWidth,available:node.clientWidth,
    body:node.querySelector('.ihr-plant-catalog__body').scrollHeight,
    bodyAvailable:node.querySelector('.ihr-plant-catalog__body').clientHeight }));
  expect(overflow.width).toBeLessThanOrEqual(overflow.available + 1);
  expect(overflow.body).toBeGreaterThan(overflow.bodyAvailable);
  await testInfo.attach('catalogo-320px',{ body:await dialog.screenshot(),contentType:'image/png' });
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('button',{ name:CATALOG_NAME })).toBeFocused();
  expect(await savedPlants(page)).toEqual([]);
});

test('una planta cae como modelo 3D en la papelera y la última planta retirada no reaparece al recargar',async ({ page },testInfo) => {
  test.setTimeout(90_000);
  const errors = []; page.on('pageerror',error => errors.push(error.message));
  const key = 'plant:catalog-trash';
  await page.evaluate(({ plantsKey,key }) => localStorage.setItem(plantsKey,JSON.stringify([
    { key,seed:key,catalogId:'cactus',variant:'cactus',potId:'akerbar',width:56,height:90,shelf:0,x:.4 }
  ])),{ plantsKey:PLANTS_KEY,key });
  await page.reload();
  const plant = page.locator(`.ihr-plant[data-object-id="${key}"]`), canvas = page.locator('.ihr-bookshelf-scene');
  await expect(plant).toBeVisible();
  await expect(canvas).toHaveAttribute('data-animating','false');
  await expect(canvas).toHaveAttribute('data-trash3d','true');
  await expect(page.locator('.ihr-shelf-trash')).toBeHidden();
  await page.getByRole('button',{ name:'Vista isométrica, libros de lado' }).click();
  await expect(canvas).toHaveAttribute('data-view-progress','1');
  await expect(canvas).toHaveAttribute('data-animating','false');
  await expect(page.locator('.ihr-shelf-trash')).toBeVisible();
  await expect(canvas).toHaveAttribute('data-trash-visible','true');
  const bounds = await plant.boundingBox();
  expect(bounds.y).toBeGreaterThanOrEqual(0);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(844);
  await page.mouse.move(bounds.x + bounds.width * .5,bounds.y + bounds.height * .85);
  await page.mouse.down(); await page.waitForTimeout(450);
  await expect(plant).toHaveClass(/is-lifted/);
  const bin = await page.locator('.ihr-shelf-trash').boundingBox();
  await page.evaluate(() => {
    const canvas = document.querySelector('.ihr-bookshelf-scene');
    const motion = window.__plantCatalogTrashMotion = { frames:[],image:null };
    motion.observer = new MutationObserver(() => {
      const progress = Number(canvas.dataset.trashDropProgress);
      if (!(progress > 0 && progress < 1)) return;
      motion.frames.push({ progress,kind:canvas.dataset.trashingObjectKind,key:canvas.dataset.trashingObjectId });
      if (!motion.image && progress > .2 && progress < .85) motion.image = canvas.toDataURL('image/png');
    });
    motion.observer.observe(canvas,{ attributes:true,attributeFilter:['data-trash-drop-progress','data-trashing-object-id'] });
  });
  await page.mouse.move(bin.x + bin.width / 2,bin.y + bin.height * .45,{ steps:14 });
  await expect(canvas).toHaveAttribute('data-trash-hover','true');
  await page.mouse.up();
  await expect(plant).toHaveCount(0,{ timeout:30_000 });
  await expect(page.locator('.ihr-bookshelf')).not.toHaveClass(/is-arranging|is-discarding/);
  const motion = await page.evaluate(() => {
    const motion = window.__plantCatalogTrashMotion; motion.observer.disconnect();
    return { frames:motion.frames,image:motion.image };
  });
  expect(motion.frames.length).toBeGreaterThan(2);
  expect(motion.frames.some(frame => frame.kind === 'plant' && frame.key === key)).toBe(true);
  expect(motion.frames.at(-1).progress).toBeGreaterThan(motion.frames[0].progress);
  expect(motion.image).toBeTruthy();
  await testInfo.attach('planta-cayendo-en-papelera-3d',{ body:Buffer.from(motion.image.split(',')[1],'base64'),contentType:'image/png' });
  await testInfo.attach('plant-trash-frames',{ body:JSON.stringify(motion.frames,null,2),contentType:'application/json' });
  expect(await savedPlants(page)).toEqual([]);
  await expect(page.locator('.ihr-spine')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.ihr-plant')).toHaveCount(0);
  await expect(canvas).toBeVisible();
  expect(await savedPlants(page)).toEqual([]);
  expect(errors).toEqual([]);
});
