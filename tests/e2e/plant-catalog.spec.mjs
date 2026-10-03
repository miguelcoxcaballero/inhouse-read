import { expect, test } from '@playwright/test';

const PLANTS_KEY = 'inhouse-read-shelf-plants';
const CATALOG_NAME = 'Abrir catálogo IKEA de plantas, estanterías e iluminación';
// The camera clock advances at most 50 ms per rendered frame. CI's software
// renderer reached progress .9977 only after 8.2 s, or .7651 with three plants;
// wait for the exact endpoint while retaining every geometry assertion.
const VIEW_TRANSITION_TIMEOUT = 30_000;
test.use({ viewport:{ width:390,height:844 },hasTouch:true,isMobile:true,deviceScaleFactor:1 });
test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion:'no-preference' });
  await page.addInitScript(() => {
    window.__plantGpu={links:0,longTasks:[]};
    for (const type of [window.WebGLRenderingContext,window.WebGL2RenderingContext]) {
      if (!type) continue;
      const original=type.prototype.linkProgram;
      type.prototype.linkProgram=function(...args) { window.__plantGpu.links++; return original.apply(this,args); };
    }
    new PerformanceObserver(list=>window.__plantGpu.longTasks.push(...list.getEntries().map(entry=>({start:entry.startTime,duration:entry.duration}))))
      .observe({type:'longtask',buffered:true});
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
  await expect(page.locator('.ihr-bookshelf-scene')).toHaveAttribute('data-view-progress','1',{ timeout:VIEW_TRANSITION_TIMEOUT });
  await expect(page.locator('.ihr-bookshelf-scene')).toHaveAttribute('data-animating','false');
  await assertIsometricOverview(page);
  const catalog = page.getByRole('button',{ name:CATALOG_NAME });
  await expect(catalog).toBeVisible();
  await expect(catalog).toHaveAttribute('data-catalog3d','true');
  const bounds = await catalog.boundingBox(), viewport = page.viewportSize();
  expect(bounds.width).toBeGreaterThanOrEqual(44);
  expect(bounds.height).toBeGreaterThanOrEqual(44);
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.y).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height + 1);
  await catalog.click();
  await expect(page.getByTestId('plant-catalog')).toBeVisible();
  await page.getByTestId('plant-catalog').evaluate(node => Promise.all(
    node.getAnimations().map(animation => animation.finished.catch(() => {}))
  ));
  return page.getByTestId('plant-catalog');
}
const savedPlants = page => page.evaluate(key => JSON.parse(localStorage.getItem(key)),PLANTS_KEY);

async function assertIsometricOverview(page) {
  const canvas = page.locator('.ihr-bookshelf-scene');
  await expect(canvas).toHaveAttribute('data-animating','false');
  await expect(canvas).toHaveAttribute('data-full-cabinet-in-frame','true');
  await expect(canvas).toHaveAttribute('data-floor-visible','false');
  await expect(page.locator('.ihr-shelf-trash')).toBeVisible();
  await expect(canvas).toHaveAttribute('data-trash-radius','44');
  await expect(canvas).toHaveAttribute('data-trash-height','140');
  const scroll = await page.locator('.ihr-bookshelf__scroll').evaluate(node => ({
    top:node.scrollTop,height:node.scrollHeight,available:node.clientHeight
  }));
  expect(scroll.top).toBe(0);
  expect(scroll.height).toBeLessThanOrEqual(scroll.available + 1);
}

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
  await expect(canvas).toHaveAttribute('data-view-progress','1',{ timeout:VIEW_TRANSITION_TIMEOUT });
  await page.reload();
  await expect(canvas).toHaveAttribute('data-view-progress','1',{ timeout:VIEW_TRANSITION_TIMEOUT });
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
  await expect(dialog.locator('[data-catalog-pot]')).toHaveCount(5);
  // Four existing containers remain available; the new compact MUSKOT is a
  // separate 9 cm nursery class (12 cm outside), selected only for new plants.
  expect(await dialog.locator('[data-catalog-pot]').evaluateAll(nodes => nodes.map(node => node.dataset.catalogPot))).toEqual([
    'muskot','muskotblomma','akerbar','gradvis','muskot9'
  ]);
  await expect(dialog.locator('[data-catalog-pot="muskot9"]')).toHaveAttribute('aria-pressed','true');
  await expect(dialog.locator('img')).toHaveCount(0);
  await dialog.locator('[data-catalog-plant="monstera"]').click();
  await dialog.locator('[data-catalog-pot="gradvis"]').click();
  await expect(dialog.locator('.ihr-plant-catalog__body:not([hidden]) .ihr-plant-catalog__caption h3')).toHaveText('MONSTERA DELICIOSA');
  await expect(dialog.locator('.ihr-plant-catalog__pot-name')).toHaveText('GRADVIS');
  await testInfo.attach('catalogo-ikea-en-movil',{ body:await dialog.screenshot(),contentType:'image/png' });
  await dialog.getByRole('button',{ name:'Añadir', exact:true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('.ihr-plant')).toHaveCount(1);
  await expect(page.locator('.ihr-plant')).toHaveAttribute('data-catalog-id','monstera');
  await expect(page.locator('.ihr-plant')).toHaveAttribute('data-pot-id','gradvis');
  const plants = await savedPlants(page);
  expect(plants).toHaveLength(1);
  expect(plants[0]).toMatchObject({ catalogId:'monstera',potId:'gradvis',variant:'monstera',width:260,height:350 });
  expect(Number.isFinite(plants[0].x)).toBe(true);
  expect(Number.isFinite(plants[0].shelf)).toBe(true);
  await expect(page.locator('.ihr-bookshelf-scene')).toHaveAttribute('data-animating','false');
  await assertIsometricOverview(page);
  await page.reload();
  await expect(page.locator('.ihr-plant')).toHaveCount(1);
  await expect(page.locator('.ihr-plant')).toHaveAttribute('data-object-id',plants[0].key);
  expect(await savedPlants(page)).toEqual(plants);
  await assertIsometricOverview(page);
  await page.getByRole('button',{ name:'Vista de canto' }).click();
  await expect(page.locator('.ihr-bookshelf-scene')).toHaveAttribute('data-view-progress','0',{ timeout:VIEW_TRANSITION_TIMEOUT });
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
  const add = dialog.getByRole('button',{ name:'Añadir', exact:true });
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
  expect(overflow.body).toBeLessThanOrEqual(overflow.bodyAvailable + 1);
  await expect(dialog.getByRole('img',{name:'IKEA',exact:true})).toBeVisible();
  for (const [width,height] of [[320,568],[390,844],[844,390],[1280,720]]) {
    await page.setViewportSize({width,height});
    // Container-query sizes and the 3D ResizeObserver settle at the next paint.
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const layout = await dialog.evaluate(node => {
      const body = node.querySelector('.ihr-plant-catalog__body'), area = body.getBoundingClientRect();
      const controls = [...body.querySelectorAll('button')].map(button => {
        const rect = button.getBoundingClientRect();
        const visible = rect.top >= area.top - 1 && rect.bottom <= area.bottom + 1 && rect.left >= area.left - 1 && rect.right <= area.right + 1;
        const target = document.elementFromPoint(rect.x + rect.width/2,rect.y + rect.height/2);
        return visible && button.contains(target);
      });
      return {scroll:body.scrollHeight,available:body.clientHeight,controls};
    });
    expect(layout.scroll).toBeLessThanOrEqual(layout.available + 1);
    expect(layout.controls.every(Boolean)).toBe(true);
  }
  await page.setViewportSize({width:320,height:568});
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
    { key,seed:key,catalogId:'cactus',variant:'cactus',potId:'akerbar',width:56,height:90,shelf:2,x:.4 }
  ])),{ plantsKey:PLANTS_KEY,key });
  await page.reload();
  const plant = page.locator(`.ihr-plant[data-object-id="${key}"]`), canvas = page.locator('.ihr-bookshelf-scene');
  await expect(plant).toBeVisible();
  await expect(canvas).toHaveAttribute('data-animating','false');
  await expect(canvas).toHaveAttribute('data-trash3d','true');
  await expect(page.locator('.ihr-shelf-trash')).toBeHidden();
  await page.getByRole('button',{ name:'Vista isométrica, libros de lado' }).click();
  await expect(canvas).toHaveAttribute('data-view-progress','1',{ timeout:VIEW_TRANSITION_TIMEOUT });
  await expect(canvas).toHaveAttribute('data-animating','false');
  await assertIsometricOverview(page);
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
  await assertIsometricOverview(page);
  await expect(page.locator('.ihr-spine')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.ihr-plant')).toHaveCount(0);
  await expect(canvas).toBeVisible();
  expect(await savedPlants(page)).toEqual([]);
  await assertIsometricOverview(page);
  expect(errors).toEqual([]);
});

test('un gesto táctil desde las hojas mueve una planta superior directamente a la papelera con toda la estantería visible y sin scroll',async ({ page },testInfo) => {
  test.setTimeout(180_000);
  const errors = []; page.on('pageerror',error => errors.push(error.message));
  const key = 'plant:touch-foliage-trash';
  const survivor = { key:'plant:touch-floor-survivor',seed:'touch-floor-survivor',catalogId:'cactus',variant:'cactus',
    potId:'akerbar',width:56,height:90,shelf:9,x:.6 };
  await page.evaluate(({ plantsKey,key,survivor }) => localStorage.setItem(plantsKey,JSON.stringify([
    { key,seed:key,catalogId:'monstera',variant:'monstera',potId:'muskot',width:86,height:110,shelf:0,x:.45 },
    survivor
  ])),{ plantsKey:PLANTS_KEY,key,survivor });
  await page.reload();
  const plant = page.locator(`.ihr-plant[data-object-id="${key}"]`);
  const canvas = page.locator('.ihr-bookshelf-scene'), scroller = page.locator('.ihr-bookshelf__scroll');
  const bin = page.locator('.ihr-shelf-trash');
  await expect(page.locator('.ihr-plant')).toHaveCount(2);
  await expect(plant).toHaveAttribute('data-shelf-index','0');
  await expect(canvas).toHaveAttribute('data-animating','false');
  await page.getByRole('button',{ name:'Vista isométrica, libros de lado' }).click();
  await expect(canvas).toHaveAttribute('data-view-progress','1',{ timeout:VIEW_TRANSITION_TIMEOUT });
  await expect(canvas).toHaveAttribute('data-animating','false');
  // The first and tenth shelves and grounded basket must fit simultaneously.
  // Neither wheel nor a native touch swipe may scroll the isometric overview.
  await assertIsometricOverview(page);
  await expect(plant).toBeInViewport();
  await expect(page.locator(`.ihr-plant[data-object-id="${survivor.key}"]`)).toBeInViewport();
  const scrollBounds = await scroller.boundingBox();
  await page.mouse.move(scrollBounds.x + 8,scrollBounds.y + scrollBounds.height * .5);
  await page.mouse.wheel(0,700);
  const swipe = await page.context().newCDPSession(page);
  try {
    const x = scrollBounds.x + 8,startY = scrollBounds.y + scrollBounds.height * .7;
    await swipe.send('Input.dispatchTouchEvent',{ type:'touchStart',touchPoints:[{ x,y:startY,id:17,radiusX:4,radiusY:4,force:1 }] });
    for (let index = 1; index <= 6; index++) await swipe.send('Input.dispatchTouchEvent',{
      type:'touchMove',touchPoints:[{ x,y:startY - scrollBounds.height * .4 * index / 6,id:17,radiusX:4,radiusY:4,force:1 }]
    });
    await swipe.send('Input.dispatchTouchEvent',{ type:'touchEnd',touchPoints:[] });
  } finally { await swipe.detach(); }
  await page.waitForTimeout(150);
  await assertIsometricOverview(page);
  const fixedPose = await canvas.getAttribute('data-trash-local-position');
  const pot = await plant.boundingBox();
  expect(pot).toBeTruthy();
  // This point was reproduced on the actual Monstera mesh in production:
  // the leaf above the ceramic pot, outside its semantic button rectangle.
  const leaf = { x:pot.x + pot.width * .5,y:pot.y - pot.height * .75 };
  expect(leaf.y).toBeLessThan(pot.y);
  expect(leaf.x).toBeGreaterThan(0);
  expect(leaf.x).toBeLessThan(page.viewportSize().width);
  expect(leaf.y).toBeGreaterThan(0);
  expect(leaf.y).toBeLessThan(page.viewportSize().height);
  await page.evaluate(() => {
    const canvas = document.querySelector('.ihr-bookshelf-scene');
    const motion = window.__plantFoliageTouch = { events:[],frames:[],image:null };
    const record = event => motion.events.push({ type:event.type,trusted:event.isTrusted,
      pointerType:event.pointerType,pointerId:event.pointerId,x:event.clientX,y:event.clientY,
      objectId:event.target.closest?.('[data-object-id]')?.dataset.objectId || '',
      target:event.target.tagName,touchAction:getComputedStyle(event.target).touchAction });
    for (const type of ['pointerdown','pointermove','pointerup','pointercancel']) document.addEventListener(type,record,true);
    motion.stop = () => {
      for (const type of ['pointerdown','pointermove','pointerup','pointercancel']) document.removeEventListener(type,record,true);
      motion.observer.disconnect();
    };
    motion.observer = new MutationObserver(() => {
      const progress = Number(canvas.dataset.trashDropProgress);
      if (!(progress > 0 && progress < 1)) return;
      motion.frames.push({ progress,kind:canvas.dataset.trashingObjectKind,key:canvas.dataset.trashingObjectId });
      if (!motion.image && progress > .2 && progress < .85) motion.image = canvas.toDataURL('image/png');
    });
    motion.observer.observe(canvas,{ attributes:true,attributeFilter:['data-trash-drop-progress','data-trashing-object-id'] });
  });
  // hasTouch/isMobile alone still leaves page.mouse as a mouse. Use Chromium's
  // native touch input, so browser pan arbitration and pointercancel are real.
  const touch = await page.context().newCDPSession(page);
  let pressed = false;
  const contact = point => ({ x:point.x,y:point.y,id:31,radiusX:4,radiusY:4,force:1 });
  const move = async (from,to,steps = 12) => {
    for (let index = 1; index <= steps; index++) {
      const fraction = index / steps;
      await touch.send('Input.dispatchTouchEvent',{ type:'touchMove',touchPoints:[contact({
        x:from.x + (to.x - from.x) * fraction,y:from.y + (to.y - from.y) * fraction
      })] });
    }
  };
  try {
    await touch.send('Input.dispatchTouchEvent',{ type:'touchStart',touchPoints:[contact(leaf)] });
    pressed = true;
    await page.waitForTimeout(1500);
    expect(await plant.evaluate(node => {
      const surfaces=[node,...node.querySelectorAll('svg,path')];
      return surfaces.every(surface => getComputedStyle(surface).userSelect === 'none');
    })).toBe(true);
    expect(await page.evaluate(() => window.getSelection().toString())).toBe('');
    await expect(plant).toHaveClass(/is-lifted/);
    await expect(bin).toBeVisible();
    await expect(canvas).toHaveAttribute('data-trash-visible','true');
    expect(await canvas.getAttribute('data-trash-local-position')).toBe(fixedPose);
    const basket = await bin.boundingBox();
    const target = { x:basket.x + basket.width / 2,y:basket.y + basket.height * .45 };
    await move(leaf,target,14);
    await expect(plant).toHaveClass(/is-dragging/);
    expect(await page.evaluate(() => window.getSelection().toString())).toBe('');
    expect(await scroller.evaluate(node => node.scrollTop)).toBe(0);
    await expect(canvas).toHaveAttribute('data-trash-hover','true');
    await touch.send('Input.dispatchTouchEvent',{ type:'touchEnd',touchPoints:[] });
    pressed = false;
    await expect(plant).toHaveCount(0,{ timeout:30_000 });
    await expect(page.locator('.ihr-bookshelf')).not.toHaveClass(/is-arranging|is-discarding/);
    await assertIsometricOverview(page);
    const motion = await page.evaluate(() => {
      const motion = window.__plantFoliageTouch; motion.stop();
      return { events:motion.events,frames:motion.frames,image:motion.image };
    });
    const down = motion.events.find(event => event.type === 'pointerdown' && event.trusted);
    expect(down).toMatchObject({ pointerType:'touch',objectId:key,touchAction:'none' });
    expect(motion.events.some(event => event.type === 'pointermove' && event.trusted && event.pointerType === 'touch')).toBe(true);
    expect(motion.events.some(event => event.type === 'pointerup' && event.trusted && event.pointerType === 'touch')).toBe(true);
    expect(motion.events.filter(event => event.type === 'pointercancel')).toEqual([]);
    expect(motion.events.filter(event => event.type === 'pointerdown')).toHaveLength(1);
    expect(motion.frames.length).toBeGreaterThan(2);
    expect(motion.frames.every(frame => frame.kind === 'plant' && frame.key === key)).toBe(true);
    expect(motion.frames.at(-1).progress).toBeGreaterThan(motion.frames[0].progress);
    expect(motion.image).toBeTruthy();
    await testInfo.attach('hojas-touch-a-papelera-3d',{ body:Buffer.from(motion.image.split(',')[1],'base64'),contentType:'image/png' });
    await testInfo.attach('native-foliage-touch-events',{ body:JSON.stringify(motion.events,null,2),contentType:'application/json' });
    await testInfo.attach('native-foliage-trash-frames',{ body:JSON.stringify(motion.frames,null,2),contentType:'application/json' });
    expect(await savedPlants(page)).toEqual([{...survivor,width:140,height:180}]);
    await assertIsometricOverview(page);
    await expect(page.locator('.ihr-plant')).toHaveCount(1);
    await page.reload();
    await expect(page.locator('.ihr-plant')).toHaveCount(1);
    await expect(plant).toHaveCount(0);
    expect(await savedPlants(page)).toEqual([{...survivor,width:140,height:180}]);
    await assertIsometricOverview(page);
    expect(errors).toEqual([]);
  } catch (error) {
    const diagnostics = await page.evaluate(() => ({
      events:window.__plantFoliageTouch?.events,frames:window.__plantFoliageTouch?.frames,
      scene:{ ...document.querySelector('.ihr-bookshelf-scene')?.dataset },
      shelfClass:document.querySelector('.ihr-bookshelf')?.className,
      scroller:(() => {
        const node = document.querySelector('.ihr-bookshelf__scroll');
        return { top:node.scrollTop,height:node.scrollHeight,available:node.clientHeight };
      })(),
      plants:[...document.querySelectorAll('.ihr-plant')].map(node => ({
        key:node.dataset.objectId,className:node.className,rect:node.getBoundingClientRect().toJSON(),
        dataset:{ ...node.dataset }
      }))
    }));
    await testInfo.attach('native-foliage-touch-failure',{ body:JSON.stringify({ leaf,pot,...diagnostics },null,2),contentType:'application/json' });
    await testInfo.attach('native-foliage-touch-failure-viewport',{ body:await page.screenshot(),contentType:'image/png' });
    throw error;
  } finally {
    if (pressed) await touch.send('Input.dispatchTouchEvent',{ type:'touchCancel',touchPoints:[] }).catch(() => {});
    await page.evaluate(() => window.__plantFoliageTouch?.stop()).catch(() => {});
    await touch.detach();
  }
});

test('las plantas de una instalación antigua migran a los modelos actuales sin fotos 2D y conservan posición, movimiento y retirada',async ({ page },testInfo) => {
  test.setTimeout(180_000);
  const errors = [], brokenAssets = [];
  page.on('pageerror',error => errors.push(error.message));
  page.on('response',response => { if (response.url().includes('/assets/') && response.status() >= 400) brokenAssets.push(response.url()); });
  page.on('requestfailed',request => { if (request.url().includes('/assets/')) brokenAssets.push(request.url()); });
  // These are the original persisted decorations, not catalog records. They
  // have no catalogId, potId or height and must upgrade on application startup.
  const legacy = [
    { key:'plant:legacy-upright',seed:'legacy-upright',variant:'sansevieria',width:52,shelf:0,x:.45 },
    { key:'plant:legacy-pothos',seed:'legacy-pothos',variant:'pothos',width:44,shelf:1,x:.5 },
    { key:'plant:legacy-suculenta',seed:'legacy-suculenta',variant:'suculenta',width:50,shelf:2,x:.65 }
  ];
  const species = [
    { catalogId:'sansevieria',variant:'sansevieria',potId:'muskot',width:150,height:250 },
    { catalogId:'hedera',variant:'hedera',potId:'muskotblomma',width:180,height:240 },
    // Legacy SUCCULENT keeps its terracotta pot: soil at 13 cm × .9 plus
    // 9 cm of foliage = 20.7 cm. The leaves are not squeezed into the old box.
    { catalogId:'succulent',variant:'succulent',potId:'muskotblomma',width:160,height:207 }
  ];
  await page.evaluate(({ plantsKey,legacy }) => {
    localStorage.setItem(plantsKey,JSON.stringify(legacy));
    localStorage.setItem('inhouse-read-shelf-view','spine');
  },{ plantsKey:PLANTS_KEY,legacy });
  await page.reload();
  const canvas = page.locator('.ihr-bookshelf-scene'), scroller = page.locator('.ihr-bookshelf__scroll');
  const nodeFor = key => page.locator(`.ihr-plant[data-object-id="${key}"]`);
  const assertModels = async () => {
    await expect(canvas).toBeVisible();
    await expect(canvas).toHaveAttribute('data-animating','false');
    await expect(canvas).toHaveAttribute('data-active-plants','3');
    await expect(page.locator('.ihr-plant')).toHaveCount(3);
    await expect(page.locator('.ihr-plant img, .ihr-plant--photo')).toHaveCount(0);
    for (let index = 0; index < legacy.length; index++) {
      const node = nodeFor(legacy[index].key), expected = species[index];
      await expect(node).toHaveAttribute('data-catalog-id',expected.catalogId);
      await expect(node).toHaveAttribute('data-pot-id',expected.potId);
      await expect(node).toHaveAttribute('data-scene-projected','true');
      // These values come from the actual Three.js model/material, not the
      // DOM's catalog label. A photo atlas on old leaves must fail this check.
      await expect(node).toHaveAttribute('data-plant-model-catalog-id',expected.catalogId);
      await expect(node).toHaveAttribute('data-plant-leaf-texture','procedural');
      await expect(node).toHaveAttribute('data-plant-leaf-opacity','opaque');
      expect(Number(await node.getAttribute('data-plant-model-depth'))).toBeGreaterThan(0);
      const foliage = node.locator('.ihr-plant-foliage');
      await expect(foliage).toHaveCount(1);
      expect(Number(await foliage.getAttribute('data-triangles'))).toBeGreaterThan(10);
      expect((await foliage.locator(':scope > path').getAttribute('d')).length).toBeGreaterThan(20);
      expect(await node.evaluate(element => getComputedStyle(element).touchAction)).toBe('none');
    }
  };
  await assertModels();
  const migrated = await savedPlants(page);
  expect(migrated).toHaveLength(3);
  for (let index = 0; index < legacy.length; index++) {
    expect(migrated[index]).toMatchObject({
      key:legacy[index].key,seed:legacy[index].seed,shelf:legacy[index].shelf,x:legacy[index].x,...species[index]
    });
    expect(migrated[index].width).toBe(species[index].width);
  }
  await testInfo.attach('legacy-plantas-3d-frontal',{ body:await page.screenshot(),contentType:'image/png' });
  await page.getByRole('button',{ name:'Vista isométrica, libros de lado' }).click();
  await expect(canvas).toHaveAttribute('data-view-progress','1',{ timeout:VIEW_TRANSITION_TIMEOUT });
  await assertModels();
  expect(await savedPlants(page)).toEqual(migrated);
  await testInfo.attach('legacy-plantas-3d-isometrica',{ body:await page.screenshot(),contentType:'image/png' });
  await page.reload();
  await expect(canvas).toHaveAttribute('data-view-progress','1',{ timeout:VIEW_TRANSITION_TIMEOUT });
  await assertModels();
  expect(await savedPlants(page)).toEqual(migrated);

  // Move one upgraded decoration using its real physical pot. Do not replace
  // the saved fixture with modern records to make the interaction pass.
  const movedKey = legacy[2].key, movedPlant = nodeFor(movedKey);
  await assertIsometricOverview(page);
  const pot = await movedPlant.boundingBox();
  const scrollBounds = await scroller.boundingBox();
  const start = { x:pot.x + pot.width * .5,y:pot.y + pot.height * .85 };
  const destination = { x:start.x - scrollBounds.width * .2,y:start.y };
  expect(destination.x).toBeGreaterThan(scrollBounds.x);
  await page.mouse.move(start.x,start.y);
  await page.mouse.down(); await page.waitForTimeout(550);
  await expect(movedPlant).toHaveClass(/is-lifted/);
  await page.mouse.move(destination.x,destination.y,{ steps:14 });
  await expect(movedPlant).toHaveClass(/is-dragging/);
  await expect(canvas).toHaveAttribute('data-drop-shelf','2');
  await expect(canvas).toHaveAttribute('data-trash-hover','false');
  await page.mouse.up();
  await expect(page.locator('.ihr-bookshelf')).not.toHaveClass(/is-arranging/);
  await expect(canvas).toHaveAttribute('data-animating','false');
  const moved = await savedPlants(page);
  expect(moved).toHaveLength(3);
  expect(moved[2].shelf).toBe(2);
  expect(Math.abs(moved[2].x - migrated[2].x)).toBeGreaterThan(.05);
  for (const field of ['key','seed','catalogId','variant','potId','width','height']) expect(moved[2][field]).toEqual(migrated[2][field]);
  expect(moved.slice(0,2)).toEqual(migrated.slice(0,2));
  await page.reload();
  await assertModels();
  await assertIsometricOverview(page);
  expect(await savedPlants(page)).toEqual(moved);

  await assertIsometricOverview(page);
  await movedPlant.press('Delete');
  await expect(movedPlant).toHaveCount(0,{ timeout:30_000 });
  expect(await savedPlants(page)).toEqual(moved.slice(0,2));
  for (const remaining of legacy.slice(0,2).reverse()) {
    const node = nodeFor(remaining.key);
    await node.press('Delete');
    await expect(node).toHaveCount(0,{ timeout:30_000 });
    await expect(page.locator('.ihr-bookshelf')).not.toHaveClass(/is-discarding/);
  }
  expect(await savedPlants(page)).toEqual([]);
  await page.reload();
  await expect(page.locator('.ihr-plant')).toHaveCount(0);
  await expect(canvas).toHaveAttribute('data-active-plants','0');
  await assertIsometricOverview(page);
  expect(await savedPlants(page)).toEqual([]);
  expect(errors).toEqual([]);
  expect(brokenAssets).toEqual([]);
});

test('la preview frontal usa el modelo 3D y el acabado elegido se conserva al añadir y recargar',async ({ page },testInfo) => {
  // CI SwiftShader spent 4.8s starting, 9.7s completing the first camera move,
  // then rendered two catalogue previews and reloaded. The whole 30s budget
  // expired after reopening; retain every assertion with room for both scenes.
  test.setTimeout(60_000);
  const errors = []; page.on('pageerror',error => errors.push(error.message));
  const dialog = await openCatalog(page);
  const preview = dialog.locator('.ihr-plant-catalog__body:not([hidden]) .ihr-plant-catalog__drawing');
  await expect(preview).toHaveAttribute('data-renderer','three-mesh');
  await expect(preview.locator('canvas')).toBeVisible();
  await expect(preview.locator('svg')).toHaveCount(0);
  await dialog.locator('[data-catalog-plant="monstera"]').click();
  await dialog.locator('[data-catalog-pot="gradvis"]').click();
  await dialog.locator('[data-catalog-color="seafoam"]').click();
  await expect(preview).toHaveAttribute('data-pot-color-id','seafoam');
  await expect(dialog.locator('[data-catalog-color="seafoam"]')).toHaveAttribute('aria-pressed','true');
  await testInfo.attach('preview-3d-gres-verde-agua',{body:await dialog.screenshot(),contentType:'image/png'});
  await dialog.getByRole('button',{name:'Añadir', exact:true }).click();
  await expect(dialog).toBeHidden();
  expect((await savedPlants(page))[0]).toMatchObject({catalogId:'monstera',potId:'gradvis',potColorId:'seafoam'});
  await expect(page.locator('.ihr-plant')).toHaveAttribute('data-pot-color-id','seafoam');
  await page.reload();
  await expect(page.locator('.ihr-plant')).toHaveAttribute('data-pot-color-id','seafoam');
  expect((await savedPlants(page))[0].potColorId).toBe('seafoam');
  const reopened = await openCatalog(page);
  await expect(reopened.locator('.ihr-plant-catalog__body:not([hidden]) .ihr-plant-catalog__drawing')).toHaveAttribute('data-renderer','three-mesh');
  await reopened.locator('[data-catalog-pot="akerbar"]').click();
  await expect(reopened.locator('[data-catalog-color="seafoam"]')).toHaveCount(0);
  await reopened.locator('[data-catalog-color="copper"]').click();
  await expect(reopened.locator('.ihr-plant-catalog__body:not([hidden]) .ihr-plant-catalog__drawing')).toHaveAttribute('data-pot-color-id','copper');
  expect(errors).toEqual([]);
});

test('una MONSTERA de 35 cm conserva su tamaño sobre el mueble en ambos tipos de estantería',async ({page},testInfo) => {
  await page.setViewportSize({width:390,height:844});
  await page.goto('./');
  await page.evaluate(({key}) => {
    localStorage.setItem(key,JSON.stringify([{key:'plant:real-monstera',seed:'preserved',catalogId:'monstera',potId:'gradvis',potColorId:'seafoam',width:92,height:126,shelf:1,x:.5}]));
    localStorage.setItem('inhouse-read-shelf-view','isometric');
  },{key:PLANTS_KEY});
  for (const type of ['walnut','baggebo']) {
    await page.evaluate(type=>localStorage.setItem('inhouse-read-shelf-type',type),type);
    await page.reload();
    const plant=page.locator('[data-object-id="plant:real-monstera"]');
    await expect(plant).toHaveAttribute('data-plant-placement','rooftop');
    await expect(plant).toHaveAttribute('data-scene-projected','true');
    expect((await savedPlants(page))[0]).toMatchObject({seed:'preserved',potColorId:'seafoam',width:260,height:350,shelf:1,x:.5});
    await expect(page.locator('.ihr-bookshelf-scene')).toHaveAttribute('data-animating','false');
    const before=await page.evaluate(()=>({links:window.__plantGpu.links,programs:+document.querySelector('.ihr-bookshelf-scene').dataset.scenePrograms,
      calls:+document.querySelector('.ihr-bookshelf-scene').dataset.sceneDrawCalls,renderCount:+document.querySelector('.ihr-bookshelf-scene').dataset.renderCount,start:performance.now()}));
    await page.setViewportSize({width:391,height:844});
    await expect.poll(async()=>+await page.locator('.ihr-bookshelf-scene').getAttribute('data-render-count')).toBeGreaterThan(before.renderCount);
    await expect(page.locator('.ihr-bookshelf-scene')).toHaveAttribute('data-animating','false');
    const after=await page.evaluate(start=>({links:window.__plantGpu.links,programs:+document.querySelector('.ihr-bookshelf-scene').dataset.scenePrograms,
      calls:+document.querySelector('.ihr-bookshelf-scene').dataset.sceneDrawCalls,longTasks:window.__plantGpu.longTasks.filter(entry=>entry.start>=start)}),before.start);
    expect(after.links-before.links).toBe(0);
    expect(after.programs).toBe(before.programs);
    expect(after.calls).toBe(before.calls);
    console.log('PLANT_GPU',type,JSON.stringify({before,after}));
    await page.setViewportSize({width:390,height:844});
    await testInfo.attach(`monstera-${type}-real`,{body:await page.screenshot({path:process.env.IHR_SIZES_EVIDENCE_DIR ? `${process.env.IHR_SIZES_EVIDENCE_DIR}/${type}.png` : undefined}),contentType:'image/png'});
  }
});
