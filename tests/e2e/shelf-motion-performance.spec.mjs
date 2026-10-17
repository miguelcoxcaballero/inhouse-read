import { expect, test } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
import { settledGeometryLength } from './helpers/settled-geometry-length.mjs';

const BOOK_PREFIX = 'motion:book:';
const LAMP_KEY = 'inhouse-read-shelf-lamps';
const PLANT_KEY = 'inhouse-read-shelf-plants';
const TARGET_URL = process.env.IHR_TEST_URL || '/';

test('cozy sounds use native PCM for switches, pickup and opening and sleep afterwards',async({page},info)=>{
 // Without the recorded atlas every event is synthesised in Rust.
 await page.route('**/sfx/atlas.*',route=>route.abort());
 await page.addInitScript(()=>{
  window.cozyProof={native:[],starts:[],contexts:[]};
  const observe=result=>{const instance=result.instance||result,actual=instance.exports;if(!actual.cozy_sound)return result;
   const exports={...actual,cozy_sound:(...args)=>{window.cozyProof.native.push(args.slice(-4));return actual.cozy_sound(...args);}};
   const proxy=new Proxy(instance,{get(target,key){return key==='exports'?exports:Reflect.get(target,key,target);}});return result.instance?{...result,instance:proxy}:proxy;};
  for(const name of ['instantiate','instantiateStreaming'])if(WebAssembly[name]){const original=WebAssembly[name];WebAssembly[name]=async function(...args){return observe(await Reflect.apply(original,WebAssembly,args));};}
  class AudioNode{gain={value:0,setTargetAtTime(){}};pan={value:0};connect(){}disconnect(){}}
  class AudioContext{
   state='running';currentTime=0;destination={};constructor(){window.cozyProof.contexts.push(this);}
   createGain(){return new AudioNode();}createStereoPanner(){return new AudioNode();}
   createBuffer(channels,length,rate){return {length,sampleRate:rate,pcm:null,copyToChannel(data){this.pcm=Array.from(data);}};}
   createBufferSource(){const source=new AudioNode();let timer;
    source.start=()=>{const b=source.buffer;if(b.length>1)window.cozyProof.starts.push({length:b.length,rms:Math.sqrt(b.pcm.reduce((s,x)=>s+x*x,0)/b.length)});timer=setTimeout(()=>source.onended?.(),b.length/b.sampleRate*1000);};
    source.stop=()=>{clearTimeout(timer);setTimeout(()=>source.onended?.(),0);};return source;}
   async suspend(){this.state='suspended';}async resume(){this.state='running';}async close(){this.state='closed';}
  }window.AudioContext=AudioContext;
 });
 const scene=await seedShelf(page);
 expect(await page.evaluate(()=>window.cozyProof.contexts.length)).toBe(0);
 const lamp=page.locator('.ihr-lamp[data-lamp-id="tarnaby"]');await lamp.tap();await quietShelf(scene);
 await expect.poll(()=>page.evaluate(()=>window.cozyProof.native.some(a=>a[0]===6||a[0]===7))).toBe(true);
 await expect.poll(()=>page.evaluate(()=>window.cozyProof.contexts.every(a=>a.state==='suspended'))).toBe(true);
 const point=await visibleMiddleBookPoint(page);expect(point).not.toBeNull();await page.touchscreen.tap(point.x,point.y);
 const cover=page.locator('.ihr-flyout__cover-target');await expect(cover).toBeVisible();
 await info.attach('fallback-before-opening',{body:JSON.stringify(await page.evaluate(()=>({native:window.cozyProof.native,states:window.cozyProof.contexts.map(c=>c.state)}))),contentType:'application/json'});
 await expect.poll(()=>page.evaluate(()=>window.cozyProof.native.some(a=>a[0]===17)),{timeout:5000}).toBe(true);
 await cover.click();await expect.poll(()=>page.evaluate(()=>window.cozyProof.native.some(a=>a[0]===1))).toBe(true);
 await expect(page.locator('#reader-toolbar')).toBeVisible();
 const starts=await page.evaluate(()=>window.cozyProof.starts);expect(starts.length).toBeGreaterThanOrEqual(3);
 expect(starts.every(s=>s.rms>.002)).toBe(true);
 await expect.poll(()=>page.evaluate(()=>window.cozyProof.contexts.every(a=>a.state==='suspended'||a.state==='closed'))).toBe(true);
});
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

async function seedShelf(page, {domino=false,single=false,mode='isometric'}={}) {
  await page.addInitScript(({ lampKey, plantKey, domino, single, mode }) => {
    localStorage.setItem('inhouse-read-shelf-view', mode);
    localStorage.setItem('inhouse-read-shelf-type', 'baggebo');
    localStorage.setItem(plantKey, JSON.stringify(single ? [] : [
      { key:'plant:motion', seed:'motion', catalogId:'sansevieria', variant:'sansevieria',
        potId:'muskot', width:42, height:124, shelf:domino?2:0, x:.76 }
    ]));
    localStorage.setItem(lampKey, JSON.stringify(single ? [] : [
      { key:'lamp:motion', lampId:'tarnaby', shelf:1, x:.56, isOn:true }
    ]));
  }, { lampKey:LAMP_KEY, plantKey:PLANT_KEY, domino, single, mode });
  await page.goto(TARGET_URL);
  await expect(page.locator('.ihr-bookshelf')).toBeVisible();
  const bytes = [...await readFile('tests/e2e/fixtures/tiny.pdf')];
  await page.evaluate(async ({ bytes, prefix, geometry, domino, single }) => {
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
    for (let index = 0; index < (single ? 1 : 6); index++) books.put({
      id:`${prefix}${index}`, title:`Libro ${index + 1}`, name:`motion-${index}.pdf`,
      format:'PDF', sourceType:'local', mimeType:'application/pdf', pageCount:260,
      ...geometry,
      content:new Blob([new Uint8Array(bytes)], { type:'application/pdf' }), cover:covers[index],
      coverFinish:index % 2 ? 'satin' : 'glossy', spineSurfaceFinish:index % 2 ? 'satin' : 'glossy',
      spineColorOverride:['#18364b', '#713b42', '#375a46'][Math.floor(index / 2)],
      shelfPosition:single ? {shelf:1,x:.5} : domino ? {shelf:index<5?0:2,x:index<5?.15+index*.04:.2} : { shelf:Math.floor(index / 2), x:index % 2 ? .38 : .19 }, shelfOrder:index,
      addedAt:Date.now(), lastOpenedAt:Date.now() - index, progressFraction:0
    });
    await new Promise((resolve, reject) => {
      transaction.oncomplete = resolve; transaction.onerror = () => reject(transaction.error);
    }); db.close();
  }, { bytes, prefix:BOOK_PREFIX, geometry:await settledGeometryLength(78_000, 'shelf-motion'), domino, single });
  await page.reload();
  const scene = page.locator('.ihr-bookshelf-scene');
  await expect(page.locator('.ihr-spine')).toHaveCount(single ? 1 : 6);
  await expect(page.locator('.ihr-plant')).toHaveCount(single ? 0 : 1);
  await expect(page.locator('.ihr-lamp')).toHaveCount(single ? 0 : 1);
  await expect(scene).toHaveAttribute('data-shelf-type', 'baggebo');
  await expect(scene).toHaveAttribute('data-view-progress', mode === 'isometric' ? '1' : '0');
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

async function visibleMiddleBookPoint(page, fractions=[.5,.65,.35], row=1) {
  return page.evaluate(({fractions,row}) => {
    const scroller = document.querySelector('.ihr-bookshelf__scroll').getBoundingClientRect();
    for (const node of document.querySelectorAll(`.ihr-spine[data-shelf-index="${row}"]`)) {
      // The book's binding target is its native padded tap rectangle. A
      // tilted cover's envelope also contains empty space; prefer the binding
      // before considering the broader cover envelope.
      const rectangles=[node.getBoundingClientRect(),node.querySelector('[data-shelf-cover-hit]')?.getBoundingClientRect()].filter(Boolean);
      for(const rect of rectangles){
      const left = Math.max(rect.left, scroller.left, 8), right = Math.min(rect.right, scroller.right, innerWidth - 8);
      const top = Math.max(rect.top, scroller.top + 8), bottom = Math.min(rect.bottom, scroller.bottom - 8, innerHeight - 8);
      if (right - left <= 12 || bottom - top <= 20) continue;
      // Check a painted book's native target, rather than an empty corner of
      // a projected rectangle or a neighbouring lamp in front of the cover.
      for (const fraction of fractions) {
        const x = left + (right - left) * fraction, y = (top + bottom) / 2;
        if (document.elementFromPoint(x, y)?.closest('.ihr-spine') === node)
          return { x, y, id:node.dataset.bookId };
      }
      }
    }
    return null;
  }, {fractions,row});
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

test('a released book settles against its neighbour and leaves the GPU idle',async({page},testInfo)=>{
 const scene=await seedShelf(page);
 const book=page.locator('[data-book-id="motion:book:1"]');
 await book.evaluate(node=>node.classList.add('is-dragging'));
 await expect(scene).toHaveAttribute('data-animating','true');
 await book.evaluate(node=>node.classList.remove('is-dragging'));
 await expect.poll(async()=>Math.abs(Number(await book.getAttribute('data-scene-lean')))).toBeGreaterThan(.01);
 await quietShelf(scene);
 const before=await scene.getAttribute('data-render-count');await page.waitForTimeout(500);
 expect(await scene.getAttribute('data-render-count')).toBe(before);
 await expect(book).toHaveAttribute('data-scene-projected','true');
 await page.screenshot({path:testInfo.outputPath('book-gravity-contact.png')});
});


test('legacy books settle on load, standing neighbours topple and a fallen support stays planted',async({page},testInfo)=>{
 const scene=await seedShelf(page,{domino:true});
 const poses=()=>page.locator('.ihr-spine').evaluateAll(nodes=>nodes.map(node=>({id:node.dataset.bookId,angle:Number(node.dataset.sceneLean),left:node.getBoundingClientRect().left,top:node.getBoundingClientRect().top})));
 const before=await poses();expect(before.some(b=>Math.abs(b.angle)>.03)).toBe(true);
 await page.evaluate(async()=>{
  const node=document.querySelector('[data-book-id="motion:book:0"]');node.classList.add('is-dragging');
  await new Promise(r=>requestAnimationFrame(r));
  // Push toward the free half: the fallen leftmost volume may already touch
  // the fixed post, which should stay fixed rather than satisfy a movement count.
  for(let frame=0;frame<60;frame++){
   node.style.setProperty('--ihr-drag-x',`${frame*160/59}px`);node.style.setProperty('--ihr-drag-y',`${18*Math.min(frame/10,1)}px`);
   await new Promise(r=>requestAnimationFrame(r));
  }
  node.classList.remove('is-dragging');node.style.removeProperty('--ihr-drag-x');node.style.removeProperty('--ihr-drag-y');
 });
 await quietShelf(scene);const after=await poses();
 await testInfo.attach('rigid-book-contact-poses',{body:JSON.stringify({before,after}),contentType:'application/json'});
 const neighbours=after.filter(b=>b.id!=='motion:book:0'&&b.id!=='motion:book:5');
 // Every neighbour remains checked. The three standing volumes topple;
 // the fourth was already lying down and now supplies a firm, non-sliding
 // support. Requiring that flat book to slide would contradict the grip fix.
 const standing=neighbours.filter(b=>Math.abs(before.find(a=>a.id===b.id).angle)<.25);
 expect(standing).toHaveLength(3);
 for(const b of standing){const old=before.find(a=>a.id===b.id);expect(Math.abs(b.angle-old.angle)>.03||Math.abs(b.left-old.left)>3).toBe(true);}
 const supports=neighbours.filter(b=>!standing.includes(b));expect(supports).toHaveLength(1);
 for(const b of supports){const old=before.find(a=>a.id===b.id);expect(Math.abs(b.angle-old.angle)).toBeLessThan(.01);expect(Math.abs(b.left-old.left)).toBeLessThan(1);expect(Math.abs(b.top-old.top)).toBeLessThan(1);}
 const renders=await scene.getAttribute('data-render-count');await page.waitForTimeout(500);expect(await scene.getAttribute('data-render-count')).toBe(renders);
 await page.screenshot({path:testInfo.outputPath('book-domino-rigid-contacts.png')});
});

// The slow-contact/domino case above and the fast lifted case below exercise
// both intended interaction speeds with the production scene and WASM solver.
test('pickup smoothly straightens a fallen book and a fast sweep leaves resting neighbours quiet',async({page},testInfo)=>{
 const scene=await seedShelf(page,{domino:true});
 const poses=()=>page.locator('.ihr-spine').evaluateAll(nodes=>nodes.map(node=>({id:node.dataset.bookId,angle:Number(node.dataset.sceneLean),left:node.getBoundingClientRect().left,top:node.getBoundingClientRect().top})));
 const resting=await poses(),fallen=resting.find(b=>Math.abs(b.angle)>.1);
 expect(fallen).toBeTruthy();const held=page.locator(`[data-book-id="${fallen.id}"]`);
 await held.evaluate(node=>node.classList.add('is-dragging'));
 await expect.poll(async()=>Math.abs(Number(await held.getAttribute('data-scene-lean')))).toBeLessThan(.025);
 await quietShelf(scene);const before=await poses();
 await held.evaluate(async node=>{
  node.style.setProperty('--ihr-drag-x','85px');node.style.setProperty('--ihr-drag-y','-35px');
  await new Promise(r=>requestAnimationFrame(r));
 });
 await quietShelf(scene);const after=await poses();
 for(const b of after.filter(b=>b.id!==fallen.id)){
  const old=before.find(a=>a.id===b.id);
  expect(Math.abs(b.angle-old.angle)).toBeLessThan(.025);
  expect(Math.abs(b.left-old.left)).toBeLessThan(1);
  expect(Math.abs(b.top-old.top)).toBeLessThan(1);
 }
 await testInfo.attach('calm-pickup-and-fast-sweep',{body:JSON.stringify({resting,before,after}),contentType:'application/json'});
 await page.screenshot({path:testInfo.outputPath('upright-pickup-fast-sweep.png')});
});


test('real pointer releases tip both ways without coasting and the renderer sleeps afterwards',async({page},testInfo)=>{
 const samples=[];
 await page.addInitScript(()=>{
  window.gripProof=[];window.toeProof=[];window.releaseDirection=0;
  const observe=result=>{
   const instance=result.instance||result,actual=instance.exports;
   if(typeof actual?.rustbookgravity_step!=='function')return result;
   const exports={...actual,rustbookgravity_step(...args){
    const states=new Float64Array(actual.memory.buffer,args[2],args[3]).slice();
    const geometry=new Float64Array(actual.memory.buffer,args[5],args[6]).slice();
    for(let i=0;i<geometry.length/9;i++)if(states[i*37+2]&6){
     window.gripProof.push(geometry[i*9+8]);
     if(window.gripProof.length>100)window.gripProof.shift();
    }
    const result=actual.rustbookgravity_step(...args);
    if(geometry.length===9&&window.releaseDirection&&!(states[2]&6)){
     const out=new Float64Array(actual.memory.buffer,args[10],args[11]);
     const angle=out[0],scale=geometry[3],width=geometry[0],height=states[26];
     const toe=states[23]+out[1]+window.releaseDirection*width/2*Math.cos(angle)+height/2*Math.sin(angle);
     const bottom=states[24]-out[2]+height/2*Math.abs(Math.cos(angle))+width/2*Math.abs(Math.sin(angle));
     window.toeProof.push({angle,toe:toe/scale,gap:(geometry[6]-bottom)/scale});
    }
    return result;
   }};
   const observed=new Proxy(instance,{get(target,key){return key==='exports'?exports:Reflect.get(target,key,target)}});
   return result.instance?{...result,instance:observed}:observed;
  };
  for(const name of ['instantiate','instantiateStreaming'])if(typeof WebAssembly[name]==='function'){
   const original=WebAssembly[name];WebAssembly[name]=async function(...args){return observe(await Reflect.apply(original,WebAssembly,args))};
  }
 });
 for(const direction of [-1,1]){
  const scene=await seedShelf(page,{single:true});
  const point=await visibleMiddleBookPoint(page,[.7,.3,.5]);expect(point).not.toBeNull();
  const book=page.locator(`[data-book-id="${point.id}"]`);
  await page.mouse.move(point.x,point.y);await page.mouse.down();
  await expect(book).toHaveClass(/is-lifted/);
  await expect.poll(async()=>Math.abs(Number(await book.getAttribute('data-scene-lean')))).toBeLessThan(.025);
  await page.evaluate(async({x,y,direction})=>{
   const node=document.querySelector('.ihr-spine');
   for(let frame=1;frame<=24;frame++){
    node.dispatchEvent(new PointerEvent('pointermove',{pointerId:1,pointerType:'mouse',buttons:1,clientX:x+direction*frame,clientY:y,bubbles:true,cancelable:true}));
    await new Promise(resolve=>requestAnimationFrame(resolve));
   }
  },{...point,direction});
  const before=await book.boundingBox();
  await page.mouse.move(point.x+direction*24,point.y);
  await page.evaluate(direction=>{window.releaseDirection=direction;window.toeProof=[]},direction);
  await page.mouse.up();
  await expect(book).not.toHaveClass(/is-dragging|is-lifted/);
  await expect.poll(async()=>Number(await book.getAttribute('data-scene-lean'))*direction).toBeLessThan(-.5);
  await quietShelf(scene);
  const after=await book.boundingBox(),angle=Number(await book.getAttribute('data-scene-lean'));
  const renders=await scene.getAttribute('data-render-count');await page.waitForTimeout(500);
  expect(await scene.getAttribute('data-render-count')).toBe(renders);
  const grips=await page.evaluate(()=>window.gripProof);
  expect(grips.length).toBeGreaterThan(0);expect(grips.some(value=>Math.abs(value)>.02)).toBe(true);
  const toes=await page.evaluate(()=>window.toeProof);
  const planted=toes.filter(sample=>sample.gap<=.0015&&sample.gap>=-.0005);
  // A software GPU can render only the final ground-contact frame. Keep
  // the display samples as evidence; the 600-step WASM regression measures
  // every contact throughout the fall rather than certifying one still pose.
  const drift=planted.length>1?Math.max(...planted.map(sample=>sample.toe))-Math.min(...planted.map(sample=>sample.toe)):null;
  samples.push({direction,before,after,angle,grips,toes,drift});
 }
 await testInfo.attach('finger-release-direction',{body:JSON.stringify(samples),contentType:'application/json'});
 await page.screenshot({path:testInfo.outputPath('directional-book-release.png')});
});

test('mobile room stays idle and suspends active physics while the document is hidden',async({page},testInfo)=>{
 const scene=await seedShelf(page);
 const session=await page.context().newCDPSession(page);await session.send('Performance.enable');
 const counts=()=>scene.evaluate(node=>({frames:Number(node.dataset.renderCount),renders:Number(node.dataset.snapshotRenderCount),textures:node.dataset.sceneTextures,resolutions:node.dataset.bookTextureResolutions}));
 const cpu=async()=>Object.fromEntries((await session.send('Performance.getMetrics')).metrics.map(m=>[m.name,m.value]));
 const before=await counts(),first=await cpu();await page.waitForTimeout(2000);const idle=await counts(),second=await cpu();
 expect(idle.frames).toBe(before.frames);expect(idle.renders).toBe(before.renders);
 await page.evaluate(()=>{
  const node=document.querySelector('.ihr-spine');node.classList.add('is-dragging');node.style.setProperty('--ihr-drag-x','12px');
 });
 await expect(scene).toHaveAttribute('data-animating','true');
 await page.evaluate(()=>{
  window.testVisibility='hidden';Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>window.testVisibility});
  document.dispatchEvent(new Event('visibilitychange'));
 });
 const parked=await counts();await page.evaluate(()=>window.dispatchEvent(new Event('resize')));await page.waitForTimeout(1200);
 expect(await counts()).toEqual(parked);
 await page.evaluate(()=>{
  const node=document.querySelector('.ihr-spine');node.classList.remove('is-dragging');node.style.removeProperty('--ihr-drag-x');
  window.testVisibility='visible';document.dispatchEvent(new Event('visibilitychange'));
 });
 await quietShelf(scene);const resumed=await counts();expect(resumed.resolutions).toBe(before.resolutions);
 expect(resumed.textures).toBe(before.textures);await expect(scene).toHaveAttribute('data-active-lamp-lights','1');
 const resting=await counts();await page.waitForTimeout(1000);expect(await counts()).toEqual(resting);
 await testInfo.attach('mobile-energy-work',{body:JSON.stringify({before,idle,parked,resumed,idleTaskSeconds:second.TaskDuration-first.TaskDuration,idleScriptSeconds:second.ScriptDuration-first.ScriptDuration},null,2),contentType:'application/json'});
});

test('native dragging pushes neighbours and preserves the settled poses across reload',async({page},testInfo)=>{
 const scene=await seedShelf(page,{domino:true});
 const point=await visibleMiddleBookPoint(page,[.5,.7,.3],0);expect(point).not.toBeNull();
 const held=page.locator(`[data-book-id="${point.id}"]`);
 const poses=()=>page.locator('.ihr-spine').evaluateAll(nodes=>nodes.map(node=>({id:node.dataset.bookId,angle:Number(node.dataset.sceneLean),left:node.getBoundingClientRect().left,top:node.getBoundingClientRect().top})));
 await page.mouse.move(point.x,point.y);await page.mouse.down();await expect(held).toHaveClass(/is-lifted/);await quietShelf(scene);
 const before=await poses();
 const savedBefore=await page.evaluate(()=>localStorage.getItem('inhouse-read-shelf-physics-v1'));expect(savedBefore).not.toBeNull();
 await page.evaluate(async({x,y,id})=>{
  const node=document.querySelector(`[data-book-id="${id}"]`);
  for(let frame=1;frame<=36;frame++){
   node.dispatchEvent(new PointerEvent('pointermove',{pointerId:1,pointerType:'mouse',buttons:1,clientX:x+frame*2,clientY:y-6*Math.min(1,frame/6),bubbles:true,cancelable:true}));
   await new Promise(resolve=>requestAnimationFrame(resolve));
  }
 },point);
 const during=await poses();
 expect(await page.evaluate(()=>localStorage.getItem('inhouse-read-shelf-physics-v1'))).toBe(savedBefore);
 await expect(held).toHaveClass(/is-dragging|is-lifted/);
 const moved=during.filter(b=>b.id!==point.id&&b.id!=='motion:book:5').filter(b=>{const old=before.find(a=>a.id===b.id);return Math.abs(b.angle-old.angle)>.03||Math.abs(b.left-old.left)>3;});
 console.info('NATIVE_BOOK_PUSH',JSON.stringify({id:point.id,before,during,moved:moved.map(b=>b.id)}));
 expect(moved.length).toBeGreaterThan(0);
 await page.mouse.move(point.x+72,point.y-6);await page.mouse.up();await quietShelf(scene);
 const frames=await scene.getAttribute('data-render-count');await page.waitForTimeout(500);expect(await scene.getAttribute('data-render-count')).toBe(frames);
 const resting=await poses();
 const saved=await page.evaluate(()=>localStorage.getItem('inhouse-read-shelf-physics-v1'));expect(saved).not.toBe(savedBefore);expect(JSON.parse(saved)[2]).toHaveLength(8);
 await page.reload();await expect(page.locator('.ihr-spine')).toHaveCount(6);await quietShelf(page.locator('.ihr-bookshelf-scene'));
 const reopened=await poses();
 for(const actual of reopened){const old=resting.find(b=>b.id===actual.id);expect(actual.angle).toBeCloseTo(old.angle,5);expect(Math.abs(actual.left-old.left)).toBeLessThan(1);expect(Math.abs(actual.top-old.top)).toBeLessThan(1);}
 await testInfo.attach('native-push-before-release',{body:JSON.stringify({point,before,during,moved,resting,reopened}),contentType:'application/json'});
});

for(const mode of ['isometric','spine'])test(`a ${mode} drop near a plant preserves every unselected slot and solid pose`,async({page},testInfo)=>{
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 const scene=await seedShelf(page,{mode});const point=await visibleMiddleBookPoint(page,[.5,.7,.3],2);expect(point).not.toBeNull();
 const slots=()=>page.locator('[data-object-id]').evaluateAll(nodes=>nodes.map(n=>({id:n.dataset.objectId,shelf:n.dataset.shelfIndex,x:n.dataset.shelfX})).sort((a,b)=>a.id.localeCompare(b.id)));
 const solids=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('inhouse-read-shelf-physics-v1'))[2].filter(row=>row[1]!==0));
 const before=await slots(),restingSolids=await solids();
 const plant=page.locator('.ihr-plant'),bounds=await plant.boundingBox();expect(bounds).not.toBeNull();
 const target={x:bounds.x+bounds.width*.5,y:bounds.y+bounds.height*.92};
 await page.mouse.move(point.x,point.y);await page.mouse.down();
 await expect(page.locator(`[data-book-id="${point.id}"]`)).toHaveClass(/is-lifted/);await quietShelf(scene);
 await page.mouse.move(target.x,target.y);await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
 await expect(scene).toHaveAttribute('data-drop-shelf','0');
 await page.mouse.up();await quietShelf(scene);
 const after=await slots();
 expect(after.find(o=>o.id===`book:${point.id}`).shelf).toBe('0');
 for(const old of before.filter(o=>o.id!==`book:${point.id}`))expect(after.find(o=>o.id===old.id)).toEqual(old);
 const settledSolids=await solids();
 for(const old of restingSolids){const actual=settledSolids.find(row=>row[0]===old[0]);expect(actual[5]).toBeCloseTo(old[5],6);expect(actual[6]).toBeCloseTo(old[6],6);expect(actual[7]).toBeCloseTo(old[7],6);}
 expect(errors).toEqual([]);await testInfo.attach('isolated-object-drop',{body:JSON.stringify({before,after,restingSolids,settledSolids}),contentType:'application/json'});
});
