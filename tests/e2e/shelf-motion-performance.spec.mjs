import { expect, test } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';

const BOOK_PREFIX = 'motion:book:';
const LAMP_KEY = 'inhouse-read-shelf-lamps';
const PLANT_KEY = 'inhouse-read-shelf-plants';
const TARGET_URL = process.env.IHR_TEST_URL || '/';
test.use({ viewport:{ width:390, height:844 }, hasTouch:true, isMobile:true, deviceScaleFactor:1 });

async function quietShelf(scene) {
  await scene.page().evaluate(() => document.fonts.ready.then(() => undefined));
  await expect(scene).toHaveAttribute('data-animating', 'false', { timeout:30_000 });
  await expect(scene).toHaveAttribute('data-inspection-moving', 'false', { timeout:30_000 });
  await expect(scene).toHaveAttribute('data-book-quality-pending', '0', { timeout:30_000 });
  await expect.poll(async () => {
    const before = await scene.getAttribute('data-snapshot-render-count');
    await scene.page().waitForTimeout(400);
    const middle = await scene.getAttribute('data-snapshot-render-count');
    await scene.page().waitForTimeout(400);
    return before === middle && middle === await scene.getAttribute('data-snapshot-render-count');
  }, { timeout:30_000 }).toBe(true);
}

async function seedShelf(page) {
  await page.addInitScript(({ lampKey, plantKey }) => {
    localStorage.setItem('inhouse-read-shelf-view', 'isometric');
    localStorage.setItem('inhouse-read-shelf-type', 'baggebo');
    localStorage.setItem(plantKey, JSON.stringify([
      { key:'plant:motion', seed:'motion', catalogId:'sansevieria', variant:'sansevieria',
        potId:'muskot', width:42, height:124, shelf:0, x:.76 }
    ]));
    localStorage.setItem(lampKey, JSON.stringify([
      { key:'lamp:motion', lampId:'tarnaby', shelf:1, x:.56, isOn:true }
    ]));
  }, { lampKey:LAMP_KEY, plantKey:PLANT_KEY });
  await page.goto(TARGET_URL);
  await expect(page.locator('.ihr-bookshelf')).toBeVisible();
  const bytes = [...await readFile('tests/e2e/fixtures/tiny.pdf')];
  await page.evaluate(async ({ bytes, prefix }) => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('inhouse-read');
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    const covers = [];
    for (let index = 0; index < 6; index++) {
      const canvas = document.createElement('canvas'); canvas.width = 400; canvas.height = 600;
      const context = canvas.getContext('2d');
      context.fillStyle = ['#18364b', '#713b42', '#375a46'][Math.floor(index / 2)];
      context.fillRect(0, 0, 400, 600); context.fillStyle = '#e8e2cf';
      context.font = '32px serif'; context.fillText(`LIBRO ${index + 1}`, 56, 112);
      covers.push(await new Promise(resolve => canvas.toBlob(resolve, 'image/png')));
    }
    const transaction = db.transaction('books', 'readwrite'), books = transaction.objectStore('books');
    for (let index = 0; index < 6; index++) books.put({
      id:`${prefix}${index}`, title:`Libro ${index + 1}`, name:`motion-${index}.pdf`,
      format:'PDF', sourceType:'local', mimeType:'application/pdf', pageCount:260,
      content:new Blob([new Uint8Array(bytes)], { type:'application/pdf' }), cover:covers[index],
      coverFinish:index % 2 ? 'satin' : 'glossy', spineSurfaceFinish:index % 2 ? 'satin' : 'glossy',
      spineColorOverride:['#18364b', '#713b42', '#375a46'][Math.floor(index / 2)],
      shelfPosition:{ shelf:Math.floor(index / 2), x:index % 2 ? .38 : .19 }, shelfOrder:index,
      addedAt:Date.now(), lastOpenedAt:Date.now() - index, progressFraction:0
    });
    await new Promise((resolve, reject) => {
      transaction.oncomplete = resolve; transaction.onerror = () => reject(transaction.error);
    }); db.close();
  }, { bytes, prefix:BOOK_PREFIX });
  await page.reload();
  const scene = page.locator('.ihr-bookshelf-scene');
  await expect(page.locator('.ihr-spine')).toHaveCount(6);
  await expect(page.locator('.ihr-plant')).toHaveCount(1);
  await expect(page.locator('.ihr-lamp')).toHaveCount(1);
  await expect(scene).toHaveAttribute('data-shelf-type', 'baggebo');
  await expect(scene).toHaveAttribute('data-view-progress', '1');
  await quietShelf(scene);
  return scene;
}

async function placement(page) {
  return page.evaluate(async prefix => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('inhouse-read');
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    const books = await new Promise((resolve, reject) => {
      const request = db.transaction('books').objectStore('books').getAll();
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    }); db.close();
    return books.filter(book => book.id.startsWith(prefix)).map(book => ({
      id:book.id, position:book.shelfPosition, order:book.shelfOrder
    })).sort((a, b) => a.id.localeCompare(b.id));
  }, BOOK_PREFIX);
}

// Native pointer handlers receive both fingers before the next display frame.
// Keeping all samples inside the page avoids measuring Playwright/CDP latency
// as animation time, or dispatching 20 inputs into one coalesced frame.
async function gesture(page, { frames, scale, panX = 0, panY = 0, monitor = false }) {
  return page.evaluate(async ({ frames, scale, panX, panY, monitor }) => {
    const scroller = document.querySelector('.ihr-bookshelf__scroll');
    const scene = document.querySelector('.ihr-bookshelf-scene');
    const snapshot = document.querySelector('.ihr-bookshelf-inspection-snapshot');
    const bounds = scene.getBoundingClientRect(), x = bounds.left + bounds.width / 2;
    const y = bounds.top + Math.min(bounds.height, scroller.clientHeight) / 2, distance = 140;
    const event = (type, id, dx, dy) => scroller.dispatchEvent(new PointerEvent(type, {
      bubbles:true, cancelable:true, pointerType:'touch', pointerId:id, isPrimary:id === 1,
      clientX:dx, clientY:dy, buttons:type === 'pointerup' ? 0 : 1, pressure:.5
    }));
    const state = () => ({
      renders:Number(scene.dataset.snapshotRenderCount), frames:Number(scene.dataset.renderCount),
      compositor:Number(scene.dataset.inspectionCompositorFrames || 0), cache:scene.dataset.inspectionCacheActive,
      zoom:Number(scene.dataset.inspectionZoom), pan:JSON.parse(scene.dataset.inspectionPan),
      dimensions:[snapshot.width, snapshot.height],
      geometries:Number(scene.dataset.sceneGeometries), textures:Number(scene.dataset.sceneTextures),
      programs:Number(scene.dataset.scenePrograms)
    });
    const samples = [], before = state(), begin = performance.now();
    let bufferWrites = 0;
    const observer = new MutationObserver(records => { bufferWrites += records.length; });
    if (monitor) for (const canvas of document.querySelectorAll('canvas'))
      observer.observe(canvas, { attributes:true, attributeFilter:['width', 'height'] });
    event('pointerdown', 1, x - distance / 2, y); event('pointerdown', 2, x + distance / 2, y);
    for (let index = 1; index <= frames; index++) {
      const progress = index / frames, spread = distance * (1 + (scale - 1) * progress);
      const cx = x + panX * progress, cy = y + panY * progress;
      event('pointermove', 1, cx - spread / 2, cy); event('pointermove', 2, cx + spread / 2, cy);
      await new Promise(resolve => requestAnimationFrame(resolve));
      samples.push(state());
    }
    bufferWrites += observer.takeRecords().length; observer.disconnect();
    const moving = state();
    event('pointerup', 1, x + panX - distance * scale / 2, y + panY);
    event('pointerup', 2, x + panX + distance * scale / 2, y + panY);
    await new Promise(resolve => requestAnimationFrame(resolve));
    return { before, moving, released:state(), samples, bufferWrites, elapsedMs:performance.now() - begin };
  }, { frames, scale, panX, panY, monitor });
}

async function warmth(scene) {
  return scene.evaluate(canvas => {
    const image = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
    let sum = 0, count = 0;
    for (let offset = 0; offset < image.data.length; offset += 4) if (image.data[offset + 3] > 240) {
      sum += image.data[offset] - image.data[offset + 2]; count++;
    }
    return sum / count;
  });
}

async function visibleMiddleBookPoint(page) {
  return page.evaluate(() => {
    const scroller = document.querySelector('.ihr-bookshelf__scroll').getBoundingClientRect();
    for (const node of document.querySelectorAll('.ihr-spine[data-shelf-index="1"]')) {
      const rect = node.querySelector('[data-shelf-cover-hit]')?.getBoundingClientRect();
      if (!rect) continue;
      const left = Math.max(rect.left, scroller.left, 8), right = Math.min(rect.right, scroller.right, innerWidth - 8);
      const top = Math.max(rect.top, scroller.top + 8), bottom = Math.min(rect.bottom, scroller.bottom - 8, innerHeight - 8);
      if (right - left <= 12 || bottom - top <= 20) continue;
      // Check a painted book's native target, rather than an empty corner of
      // a projected rectangle or a neighbouring lamp in front of the cover.
      for (const fraction of [.5, .65, .35]) {
        const x = left + (right - left) * fraction, y = (top + bottom) / 2;
        if (document.elementFromPoint(x, y)?.closest('.ihr-spine') === node)
          return { x, y, id:node.dataset.bookId };
      }
    }
    return null;
  });
}

async function pinchStartingOnBook(page, scene) {
  const point = await visibleMiddleBookPoint(page);
  expect(point, 'the initial finger must touch a real middle-shelf book').not.toBeNull();
  const cdp = await page.context().newCDPSession(page);
  const contact = (id, x, y) => ({ id, x, y, radiusX:3, radiusY:3, force:1 });
  await page.evaluate(point => {
    const scroller = document.querySelector('.ihr-bookshelf__scroll'), canvas = document.querySelector('.ihr-bookshelf-scene');
    const state = () => ({
      renders:Number(canvas.dataset.snapshotRenderCount), compositor:Number(canvas.dataset.inspectionCompositorFrames || 0),
      zoom:Number(canvas.dataset.inspectionZoom), cache:canvas.dataset.inspectionCacheActive,
      pressed:[...document.querySelectorAll('.ihr-spine.is-pressed')].map(node => node.dataset.bookId)
    });
    window.__motionNativeBookStart = new Promise((resolve, reject) => {
      const firstDown = event => {
        if (event.pointerType !== 'touch') return;
        scroller.removeEventListener('pointerdown', firstDown);
        const firstId = event.pointerId, secondId = firstId + 100;
        const secondX = point.x + (point.x < 260 ? 80 : -80), centerX = (point.x + secondX) / 2;
        const dispatch = (type, id, x, y) => scroller.dispatchEvent(new PointerEvent(type, {
          bubbles:true, cancelable:true, pointerType:'touch', pointerId:id, isPrimary:id === firstId,
          clientX:x, clientY:y, buttons:type === 'pointerup' ? 0 : 1, pressure:.5
        }));
        // Register before the book's MutationObserver requests its expensive
        // repaint. The next display frame records the real native press and
        // adds the other finger before software-GPU latency can turn the
        // intended pinch into a several-second hold. Timers remain native.
        requestAnimationFrame(() => {
          (async () => {
            const firstFrame = state();
            dispatch('pointerdown', secondId, secondX, point.y);
            const began = state(), samples = [], scale = 1.02, pan = 2;
            for (let frame = 1; frame <= 10; frame++) {
              const progress = frame / 10, ratio = 1 + (scale - 1) * progress;
              dispatch('pointermove', firstId, centerX + (point.x - centerX) * ratio + pan * progress, point.y);
              dispatch('pointermove', secondId, centerX + (secondX - centerX) * ratio + pan * progress, point.y);
              await new Promise(resolve => requestAnimationFrame(resolve));
              samples.push(state());
            }
            resolve({ firstFrame, began, moving:samples.at(-1), samples, firstId, secondId,
              end:{ x:centerX + (secondX - centerX) * scale + pan, y:point.y },
              beginGpuFrames:began.renders - firstFrame.renders,
              gpuFrames:samples.at(-1).renders - firstFrame.renders,
              compositorFrames:samples.at(-1).compositor - firstFrame.compositor });
          })().catch(reject);
        });
      };
      // Bubble order lets the real book handlers mark the native contact as
      // pressed; capture order would observe it before those handlers run.
      scroller.addEventListener('pointerdown', firstDown);
    });
  }, point);
  await cdp.send('Input.dispatchTouchEvent', { type:'touchStart', touchPoints:[contact(21, point.x, point.y)] });
  const motion = await page.evaluate(() => window.__motionNativeBookStart);
  expect(motion.firstFrame.pressed, 'the first finger must exercise the real book press').toContain(point.id);
  expect(motion.gpuFrames, 'press cancellation must not force a full 3D repaint per finger frame').toBeLessThanOrEqual(3);
  expect(motion.compositorFrames).toBeGreaterThanOrEqual(8);
  expect(motion.samples.filter(sample => sample.cache === 'true').length).toBeGreaterThanOrEqual(8);
  expect(motion.moving.zoom).toBeCloseTo(motion.firstFrame.zoom * 1.02, 3);
  await cdp.send('Input.dispatchTouchEvent', { type:'touchEnd', touchPoints:[] });
  await page.evaluate(({ secondId, end }) => {
    document.querySelector('.ihr-bookshelf__scroll').dispatchEvent(new PointerEvent('pointerup', {
      bubbles:true, cancelable:true, pointerType:'touch', pointerId:secondId,
      clientX:end.x, clientY:end.y, buttons:0
    }));
    delete window.__motionNativeBookStart;
  }, motion);
  await quietShelf(scene);
  await expect(page.locator('.ihr-spine.is-pressed, .ihr-spine.is-lifted, .ihr-spine.is-dragging')).toHaveCount(0);
  await expect(page.locator('.ihr-flyout')).toHaveCount(0);
  await cdp.detach();
  return motion;
}

test('isometric finger motion reuses its image, restores sharp books and keeps real lamp/book targets usable', async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  await page.emulateMedia({ reducedMotion:'reduce' });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error' && /THREE\.WebGLProgram|VALIDATE_STATUS|shader.*(?:compil|link)|GL_INVALID/i.test(message.text()))
      errors.push(message.text());
  });
  const scene = await seedShelf(page), originalPlacement = await placement(page);
  await expect(scene).toHaveAttribute('data-active-plants', '1');
  await expect(scene).toHaveAttribute('data-active-lamps', '1');
  await expect(scene).toHaveAttribute('data-active-lamp-lights', '1');
  await page.evaluate(() => {
    window.__motionBookNodes = new Map([...document.querySelectorAll('.ihr-spine')]
      .map(node => [node.dataset.bookId, node]));
  });

  await gesture(page, { frames:4, scale:1.8 });
  await quietShelf(scene);
  const motion = await gesture(page, { frames:20, scale:4 / 3, panX:44, panY:12, monitor:true });
  const gpuFrames = motion.moving.renders - motion.before.renders;
  const compositorFrames = motion.moving.compositor - motion.before.compositor;
  expect(motion.samples.length).toBe(20);
  expect(motion.moving.frames - motion.before.frames).toBeGreaterThanOrEqual(20);
  // No timing limit: software GPUs in CI are intentionally slower. Instead
  // require that almost every distinct finger frame avoids a WebGL repaint.
  expect(gpuFrames, '20 finger frames must not repaint the full 3D scene').toBeLessThanOrEqual(5);
  expect(compositorFrames, 'the cached room must follow both fingers').toBeGreaterThanOrEqual(15);
  expect(motion.moving.zoom).toBeCloseTo(2.4, 3);
  expect(motion.moving.pan[0] - motion.before.pan[0]).toBeGreaterThan(35);
  expect(motion.samples.filter(sample => sample.cache === 'true').length).toBeGreaterThanOrEqual(15);
  for (const key of ['geometries', 'textures', 'programs'])
    expect(Number.isFinite(motion.before[key]), `${key} must be reported by the real renderer`).toBe(true);
  // width/height assignments reset backing buffers. They may occur when an
  // overscan capture is rebased, but never on each compositor-only frame.
  expect(motion.bufferWrites).toBeLessThanOrEqual(gpuFrames * 8 + 2);
  for (let index = 1; index < motion.samples.length; index++) {
    const previous = motion.samples[index - 1], current = motion.samples[index];
    if (previous.renders !== current.renders) continue;
    expect(current.dimensions).toEqual(previous.dimensions);
    for (const key of ['geometries', 'textures', 'programs'])
      expect(current[key], `${key} must remain stable between cached frames`).toBe(previous[key]);
  }

  await quietShelf(scene);
  await expect(scene).toHaveAttribute('data-inspection-cache-active', 'false');
  await expect.poll(async () => Number(await scene.getAttribute('data-high-resolution-books'))).toBeGreaterThan(0);
  const resolutions = await scene.getAttribute('data-book-texture-resolutions');
  const sharpResolutions = JSON.parse(resolutions).filter(Boolean);
  expect(sharpResolutions.length).toBeGreaterThan(0);
  expect(sharpResolutions.every(value => value === 1024 || value === 2048)).toBe(true);
  expect(await placement(page)).toEqual(originalPlacement);
  expect(await page.evaluate(() => [...document.querySelectorAll('.ihr-spine')]
    .every(node => window.__motionBookNodes.get(node.dataset.bookId) === node))).toBe(true);

  const bookStartMotion = await pinchStartingOnBook(page, scene);
  expect(await placement(page)).toEqual(originalPlacement);

  const lamp = page.locator('.ihr-lamp[data-lamp-id="tarnaby"]'), litWarmth = await warmth(scene);
  await expect(lamp).toHaveAttribute('aria-pressed', 'true');
  await lamp.tap(); await expect(lamp).toHaveAttribute('data-lamp-power', '0.0000');
  await quietShelf(scene);
  const offWarmth = await warmth(scene);
  expect(litWarmth - offWarmth, 'warm light must still illuminate the zoomed room').toBeGreaterThan(.5);
  const savedLamps = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), LAMP_KEY);
  expect(savedLamps[0].isOn).toBe(false);
  await lamp.tap(); await expect(lamp).toHaveAttribute('data-lamp-power', '1.0000'); await quietShelf(scene);

  // Use the final projected cover hit area, rather than scrolling a thin
  // spine into view and accidentally hiding an out-of-date interaction map.
  const point = await visibleMiddleBookPoint(page);
  expect(point, 'a middle-shelf cover must have a usable projected touch target').not.toBeNull();
  await page.touchscreen.tap(point.x, point.y);
  await expect(page.locator('.ihr-flyout__cover-target')).toBeVisible({ timeout:30_000 });
  await page.getByRole('button', { name:'Cerrar', exact:true }).click();
  await expect(page.locator('.ihr-flyout')).toHaveCount(0, { timeout:30_000 });
  await quietShelf(scene);

  const metrics = { ...motion, gpuFrames, compositorFrames, bookStartMotion, litWarmth, offWarmth,
    sharpBooks:Number(await scene.getAttribute('data-high-resolution-books')),
    resolutions:resolutions && JSON.parse(resolutions), drawCalls:Number(await scene.getAttribute('data-scene-draw-calls')) };
  console.log(`ISOMETRIC_MOTION_METRICS ${JSON.stringify(metrics)}`);
  await testInfo.attach('isometric-motion-metrics', { body:Buffer.from(JSON.stringify(metrics, null, 2)), contentType:'application/json' });
  const screenshot = await page.screenshot();
  await testInfo.attach('baggebo-inspection-sharp', { body:screenshot, contentType:'image/png' });
  if (process.env.IHR_MOTION_REVIEW_DIR) {
    await mkdir(process.env.IHR_MOTION_REVIEW_DIR, { recursive:true });
    await page.screenshot({ path:`${process.env.IHR_MOTION_REVIEW_DIR}/baggebo-motion-settled.png` });
  }
  expect(errors).toEqual([]);
});
