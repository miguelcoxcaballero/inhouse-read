// A book view is built and driven by the shelf module (rust-ui/src/book_view_host.rs; the per-frame drawing
// stays in src/js/book-model.js). Compared with the frozen JavaScript it replaced
// (helpers/reference-book-model.js): every renderer call (sizes, ratios, viewports, compiles, uploads and each
// draw's model pose and camera window), every copy to and clear of the export canvas, the export canvas's
// dataset, opacity and place in the page, the live canvas's class, style and parent, every method's result
// and the pose, over shelf and lifted views, direct and snapshot presentation, page snapshots, appearance
// replacements (immediate and after a cover download), the parked return upgrade, relief preparation,
// animations stepped frame by frame, the shelf insertion handoff, release and disposal.
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const gpu = vi.hoisted(() => ({ log:[], images:{ mode:'sync', pending:[] } }));
vi.mock('../../src/js/rust-shelf.js', async () => (await import('./helpers/rust-shelf-real.js')).rustShelfMock());
vi.mock('../../src/js/rust-core.js', async () => (await import('./helpers/rust-core-real.js')).rustCoreMock());
vi.mock('../../src/js/book-cover-images.js', async original => ({ ...await original(),
  acquireCoverImage:(url, onImage, onError) => {
    const deliver = () => {
      if (url.includes('broken')) onError(new Error('decode'));
      else onImage({ width:400, height:600, tag:url }, { url });
    };
    if (gpu.images.mode === 'sync') deliver(); else gpu.images.pending.push(deliver);
    return () => {};
  } }));
vi.mock('three', async importOriginal => {
  const THREE = await importOriginal();
  const round = value => Math.round(value * 1e6) / 1e6;
  class Renderer {
    constructor(options) {
      this.options = options; this.kind = options?.preserveDrawingBuffer ? 'presentation' : 'shared';
      this.domElement = document.createElement('canvas'); this.domElement.kind = this.kind;
      this.shadowMap = {}; this.info = { programs:[] };
      this.capabilities = { getMaxAnisotropy:() => 4 };
      this.size = new THREE.Vector2(); this.ratio = 1;
      gpu.log.push([this.kind, 'created']);
    }
    getContext() { gpu.log.push([this.kind, 'getContext']); return { isContextLost:() => false }; }
    getSize(target) { return target.copy(this.size); }
    setSize(width, height, style) {
      gpu.log.push([this.kind, 'setSize', width, height, style]);
      this.size.set(width, height); this.domElement.width = Math.floor(width * this.ratio); this.domElement.height = Math.floor(height * this.ratio);
    }
    getPixelRatio() { return this.ratio; }
    setPixelRatio(value) { gpu.log.push([this.kind, 'setPixelRatio', value]); this.ratio = value; this.setSize(this.size.x, this.size.y); }
    setViewport(...args) { gpu.log.push([this.kind, 'setViewport', ...args]); }
    compile() { gpu.log.push([this.kind, 'compile']); }
    initTexture(texture) { gpu.log.push([this.kind, 'initTexture', texture.anisotropy]); }
    render(scene, camera) {
      const model = scene.children.find(object => object.isGroup);
      gpu.log.push([this.kind, 'render', model.position.toArray().map(round), model.rotation.toArray().slice(0, 3).map(round), round(model.scale.x),
        this.size.toArray(), this.ratio, camera.view?.enabled ? [camera.view.offsetX, camera.view.offsetY, camera.view.width, camera.view.height] : null,
        model.children.filter(child => child.visible).length]);
      this.domElement.frame = gpu.log.length;
    }
    dispose() {}
  }
  class PMREM { fromScene() { return { texture:new THREE.Texture() }; } dispose() {} }
  return { ...THREE, WebGLRenderer:Renderer, PMREMGenerator:PMREM };
});

let contexts;
const label = value => value?.kind ?? (typeof value === 'number' ? Math.round(value * 1e6) / 1e6 : value instanceof HTMLCanvasElement ? 'canvas' : value);
class Context {
  constructor(canvas) { this.canvas = canvas; }
  drawImage(source, ...args) { gpu.log.push(['context', 'drawImage', label(source), ...args.map(label)]); }
  clearRect(...args) { gpu.log.push(['context', 'clearRect', ...args.map(label)]); }
  measureText(text) { return { width:String(text).length * 9 }; }
  createLinearGradient() { return { addColorStop() {} }; }
  createRadialGradient() { return { addColorStop() {} }; }
  createPattern() { return {}; }
  getImageData(_x, _y, width, height) { return { data:new Uint8ClampedArray(width * height * 4), width, height }; }
  createImageData(width, height) { return { data:new Uint8ClampedArray(width * height * 4), width, height }; }
}

beforeEach(() => {
  vi.resetModules(); contexts = new WeakMap(); gpu.log.length = 0; gpu.images.mode = 'sync'; gpu.images.pending.length = 0;
  vi.stubGlobal('WebGLRenderingContext', function WebGLRenderingContext() {});
  vi.stubGlobal('devicePixelRatio', 2);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function(type) {
    if (type !== '2d') return null;
    if (!contexts.has(this)) contexts.set(this, new Proxy(new Context(this), { get:(target, key) => key in target ? Reflect.get(target, key) : () => {} }));
    return contexts.get(this);
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(() => 'data:');
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(callback => callback(null));
});
afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const book = { id:'view:1', title:'Actual Book', author:'Reader', format:'EPUB', progress:.4, locator:'epubcfi(/6/2)', coverFinish:'glossy' };
const style = { color:'#42604b', shade:'#324c3a', ink:'#ffffff', coverRatio:.66, width:40, fontFamily:'Lora' };
const pose = { x:0, y:0, scale:1, angle:0, pitch:0, roll:0, coverOpen:1, bookmarkWithdraw:1, pageTheme:1 };
const page = (width, height, extra = {}) => {
  const source = document.createElement('canvas'); source.width = width; source.height = height;
  return { source, width, height, toneKey:`tone-${width}`, text:`Página ${'é'.repeat(600)}`, location:{ locator:'epubcfi(/6/4)' }, sourceType:'epub', ...extra };
};

// The page, the clock and the frames are the test's: animations advance only when stepped.
function clock() {
  let now = 1000, serial = 0; const scheduled = new Map();
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.stubGlobal('requestAnimationFrame', callback => { const id = ++serial; scheduled.set(id, callback); return id; });
  vi.stubGlobal('cancelAnimationFrame', id => scheduled.delete(id));
  return { frames:(count, ms = 16) => { for (let i = 0; i < count && scheduled.size; i++) {
    const [id, callback] = scheduled.entries().next().value; scheduled.delete(id); now += ms; callback(now);
  } }, pending:() => scheduled.size };
}
const summary = value => {
  if (value instanceof Promise) return 'promise';
  if (typeof value === 'function') return 'function';
  if (value === undefined) return 'undefined';
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).map(key => [key, summary(value[key])]));
  return value;
};
function observe(view, stage) {
  const live = document.querySelector('.ihr-book-live-canvas');
  return { dataset:{ ...view.canvas.dataset }, opacity:view.canvas.style.opacity, connected:view.canvas.isConnected,
    stage:stage.style.position, live:live ? [live.kind, live.style.cssText, live.parentElement?.className] : null,
    pose:view.getPose(), theme:view.getPageTheme() };
}
async function run(module, options, script) {
  const stage = document.createElement('div'); stage.className = 'stage';
  const host = document.createElement('div'); stage.append(host); document.body.append(stage);
  gpu.log.length = 0;
  const view = module.bookView(host, { ...book }, { ...style }, { width:132, height:200, thickness:40, viewportWidth:390, viewportHeight:844,
    centerX:195, centerY:350, ...options });
  if (!view) return [['null']];
  vi.spyOn(view.canvas, 'getBoundingClientRect').mockReturnValue({ left:3, top:7, width:390, height:844, right:393, bottom:851 });
  const steps = [['built', summary(view), observe(view, stage), gpu.log.splice(0)]];
  const step = async (name, result) => {
    let value = result;
    if (result instanceof Promise) value = ['promise', summary(await result.then(v => v, error => `rejected ${error?.message}`))];
    steps.push([name, summary(value), observe(view, stage), gpu.log.splice(0)]);
  };
  try { await script(view, step, stage); } finally { document.body.replaceChildren(); }
  return steps;
}
async function compare(options, script, name) {
  const time = clock();
  const reference = await import('./helpers/reference-book-model.js');
  // The cover raster cache outlives a module reload and each module keeps its renderers: a warm-up run of
  // each module leaves both compared runs the same caches.
  await run(reference, options, (view, step, stage) => script(view, step, stage, time));
  const expected = await run(reference, options, (view, step, stage) => script(view, step, stage, time));
  vi.resetModules(); gpu.log.length = 0;
  const production = await import('../../src/js/book-model.js');
  await run(production, options, (view, step, stage) => script(view, step, stage, time));
  const actual = await run(production, options, (view, step, stage) => script(view, step, stage, time));
  expect(actual.length, name).toBe(expected.length);
  for (let i = 0; i < expected.length; i++) {
    const a = JSON.stringify(actual[i]), e = JSON.stringify(expected[i]);
    if (a !== e) {
      let at = 0; while (a[at] === e[at]) at++;
      throw new Error(`${name}, step ${expected[i][0]}: ...${a.slice(Math.max(0, at - 300), at + 300)}\n  expected ...${e.slice(Math.max(0, at - 300), at + 300)}`);
    }
  }
}

const layouts = [
  { initialPose:pose, deferDraw:true },
  { initialPose:pose, compactReturnFrame:true, adaptiveNativeFrame:true },
  { compactReturnFrame:true, viewportWidth:1280, viewportHeight:900 },
  { shelf:true, shelfView:'isometric' },
  { shelf:true },
  { directPresentation:false, initialPose:{ ...pose, coverOpen:0 } },
];

it('draws, snapshots and exports pages like the original', async () => {
  for (const options of layouts) await compare(options, async (view, step) => {
    await step('draw closed', view.draw({ ...pose, coverOpen:0, angle:90, scale:.3, x:-100, y:140 }));
    await step('draw open', view.draw(pose));
    await step('export', view.canvas.getContext('2d') && view.canvas.toDataURL());
    const snapshot = page(600, 900, { paper:page(600, 900) });
    await step('snapshot', view.setPageSnapshot(snapshot, { pageTheme:.2 }));
    await step('has', [view.hasPageSnapshot(snapshot), view.hasPageSnapshot(page(1, 1)), view.hasPageSnapshot(null)]);
    await step('commit', view.commitPreparedPage(snapshot));
    await step('commit other theme', view.commitPreparedPage(snapshot, { pageTheme:.9 }));
    await step('commit unknown', view.commitPreparedPage(page(10, 10)));
    await step('textures', view.pageTextures().length);
    await step('upload', view.pageTextures().map(texture => view.uploadPageTexture(texture)).concat(view.uploadPageTexture({})));
    await step('compile', Array.isArray(view.compilePage()));
    await step('programs', view.preparePagePrograms(callback => callback?.(), () => true));
    await step('theme', view.setPageTheme(.6));
    await step('withdraw', view.setBookmarkWithdraw(.3));
    await step('second snapshot', view.setPageSnapshot(page(500, 800, { text:'', sourceType:undefined, engine:'pdf', location:'p3' }), { redraw:false }));
    await step('no locator', view.setPageSnapshot(page(500, 800, { sourceType:undefined, location:undefined, width:0, height:0 })));
    await step('bounds', view.getPageBounds());
    await step('align', view.alignToPage({ left:0, top:0, width:390, height:600 }));
    await step('defer', view.deferDrawing());
    await step('draw after defer', view.draw({ ...pose, angle:20 }, { redraw:false }));
    await step('release resume', view.releaseToSnapshot({ resume:true }));
    await step('draw suspended', view.draw(pose));
    await step('hold', typeof view.holdNativeMotionFrame());
    await step('compact', view.setCompactReturnFrame(0));
    await step('release', view.releaseToSnapshot());
    await step('draw released', view.draw({ ...pose, angle:10 }));
    await step('dispose kept', view.dispose(false));
    await step('after dispose', [view.setPageSnapshot(snapshot), view.updateBookmark(book), view.updateAppearance(style), view.commitPreparedPage(snapshot)]);
    await step('dispose again', view.dispose());
  }, JSON.stringify(options));
}, 120_000);

it('changes appearance, bookmark, relief and the parked return like the original', async () => {
  for (const options of [layouts[0], layouts[1], layouts[3]]) await compare(options, async (view, step) => {
    await step('draw', view.draw(pose));
    await step('spine', view.updateSpineAppearance({ ...book, spineFinish:'gold' }, { ...style, color:'#7a1f24' }));
    await step('cover quiet', view.updateCoverAppearance({ ...book, coverFinish:'matte' }, { redraw:false }));
    await step('cover', view.updateCoverAppearance({ ...book, coverFinish:'satin' }, null));
    await step('edges', view.updateEdgeAppearance({ ...book, pageEdgeFinish:'glossy' }));
    await step('editor', view.updateEditorAppearance({ ...book, coverFinish:'glossy', pageEdgeFinish:'matte' }));
    await step('bookmark same', view.updateBookmark({ ...book }));
    await step('bookmark moved', view.updateBookmark({ ...book, progress:.8 }));
    await step('bookmark quiet', view.updateBookmark({ ...book, progress:.9 }, { redraw:false }));
    await step('bookmark gone', view.updateBookmark({ ...book, progress:0, locator:undefined }));
    await step('replace', view.updateAppearance({ ...style, color:'#18364b' }));
    await step('ready', view.ready);
    await step('reuse', view.updateAppearance({ ...style, color:'#18364b', ink:'#000000' }, { reuseModel:true }));
    await step('reuse same', view.updateAppearance({ ...style, color:'#18364b', ink:'#000000' }, { reuseModel:true }));
    await step('relief', view.prepareCoverRelief());
    await step('relief again', view.prepareCoverRelief());
    await step('set relief', view.setCoverRelief({ id:'color-1', color:'#42604b', tolerance:4, strength:.75 }));
    await step('clear relief', view.setCoverRelief(null));
    await step('return same', view.prepareReturnAppearance({ ...book, progress:.5 }, { ...style, color:'#18364b', ink:'#000000' }, null));
    await step('return new cover', view.prepareReturnAppearance({ ...book, title:'Renamed' }, { ...style, color:'#18364b', ink:'#000000' }, 'blob:cover'));
    await step('return incompatible', view.prepareReturnAppearance({ ...book }, { ...style, coverRatio:.9 }, null));
    await step('dispose', view.dispose());
    await step('after dispose', [view.prepareReturnAppearance(book, style, null), view.prepareCoverRelief(), view.setCoverRelief(null)]);
  }, JSON.stringify(options));
}, 120_000);

it('replaces a model after its cover arrives, and drops an outdated one, like the original', async () => {
  await compare({ initialPose:pose, coverUrl:'blob:cover' }, async (view, step) => {
    gpu.images.mode = 'async';
    await step('replace pending', view.updateAppearance({ ...style, color:'#18364b' }));
    await step('replace again', view.updateAppearance({ ...style, color:'#713b42' }));
    await step('spine while pending', view.updateSpineAppearance({ ...book, spineFinish:'silver' }, { ...style, color:'#713b42' }));
    await step('snapshot while pending', view.setPageSnapshot(page(600, 900)));
    for (const deliver of gpu.images.pending.splice(0)) deliver();
    await step('delivered', view.ready);
    await step('return pending', (() => { const result = view.prepareReturnAppearance({ ...book, title:'Other' }, { ...style, color:'#713b42' }, 'blob:next');
      for (const deliver of gpu.images.pending.splice(0)) deliver(); return result; })());
    await step('return broken', (() => { const result = view.prepareReturnAppearance({ ...book, title:'Broken' }, { ...style, color:'#713b42' }, 'blob:broken');
      for (const deliver of gpu.images.pending.splice(0)) deliver(); return result; })());
    await step('dispose while pending', (() => { view.updateAppearance({ ...style, color:'#2f2f4f' }); view.dispose(); return 'disposed'; })());
    for (const deliver of gpu.images.pending.splice(0)) deliver();
    await step('late cover', 'settled');
  }, 'cover download');
}, 120_000);

it('animates the board, bookmark, page and theme frame by frame like the original', async () => {
  for (const options of [layouts[0], layouts[1], layouts[2]]) await compare(options, async (view, step, _stage, time) => {
    await step('draw', view.draw({ ...pose, coverOpen:0, angle:90, scale:.3, x:-100, y:140 }));
    const open = view.animateCoverOpen({ duration:240, offsetX:20 });
    await step('open started', [Object.keys(open), time.pending()]);
    time.frames(4); await step('open midway', time.pending());
    time.frames(40); await step('open done', open.finished);
    const close = view.animateCoverClose({ targetPose:{ scale:.5, y:10 } });
    time.frames(3); await step('close midway', time.pending());
    close.cancel(); await step('close cancelled', close.finished);
    const close2 = view.animateCoverClose();
    time.frames(60); await step('close done', close2.finished);
    view.draw(pose);
    const bookmark = view.animateBookmark({ withdraw:.5 });
    time.frames(40); await step('bookmark', bookmark.finished);
    const theme = view.animatePageTheme({ from:0, duration:100 });
    time.frames(10); await step('theme', theme.finished);
    const theme2 = view.animatePageTheme();
    time.frames(60); await step('theme default', theme2.finished);
    const zoom = view.animateToPage({ left:0, top:0, width:390, height:600, pageTheme:.4, duration:160 });
    time.frames(20); await step('zoom', zoom.finished);
    const none = view.animateToPage({ left:0, top:0, width:0, height:0 });
    await step('zoom nowhere', [Object.keys(none), none.finished]);
    const custom = view.animate([{ transform:pose }, { transform:{ ...pose, angle:30 } }], { duration:80, onFrame:() => false });
    time.frames(10); await step('animate', custom.finished);
    await step('dispose', view.dispose());
    const late = view.animateCoverOpen();
    await step('after dispose', [Object.keys(late), late.finished]);
  }, JSON.stringify(options));
}, 120_000);

it('hands a presented book over to a shelf insertion like the original', async () => {
  const scenario = path => async (view, step) => {
    await step('draw', view.draw(pose));
    const calls = [];
    const lease = owner => ({ isOwner:() => owner, capture:() => calls.push('capture'), dispose:options => calls.push(['dispose', options]) });
    let handle;
    try { handle = view.handoffToShelfInsertion(bridge => {
      calls.push(Object.keys(bridge), bridge.canvas === view.canvas);
      if (path === 'decline') return null;
      if (path === 'throw') throw new Error('start failed');
      const created = bridge.createLease({ onPaint:() => {} });
      calls.push(['lease', summary(created), bridge.createLease({})]);
      if (path === 'cancel') { bridge.cancel(); return { path }; }
      calls.push(['commit', bridge.commit(null), bridge.commit(lease(true))]);
      calls.push(['commit real', bridge.commit(created)]);
      if (path === 'fallback') calls.push(['fallback', bridge.fallback() === contexts.get(view.canvas)]);
      if (path === 'late cancel') bridge.cancel();
      return { path };
    }); } catch (error) { handle = `threw ${error.message}`; }
    await step(`handoff ${path}`, [summary(handle), calls]);
    await step('second handoff', view.handoffToShelfInsertion(() => ({})));
    await step('export', view.canvas.getContext('2d') && 'ok');
    await step('draw after', view.draw({ ...pose, angle:15 }));
    await step('dispose', view.dispose());
  };
  for (const path of ['commit', 'decline', 'cancel', 'fallback', 'late cancel', 'throw']) {
    await compare({ initialPose:pose }, scenario(path), path);
  }
}, 120_000);

it('rejects missing options like the original', async () => {
  const reference = await import('./helpers/reference-book-model.js');
  vi.resetModules();
  const production = await import('../../src/js/book-model.js');
  for (const options of [undefined, null]) {
    expect(() => production.bookView(document.body, book, style, options)).toThrow(TypeError);
    expect(() => reference.bookView(document.body, book, style, options)).toThrow(TypeError);
  }
});

it('holds no WebAssembly handle once views are built, driven and disposed', async () => {
  const time = clock();
  const { needRustShelf } = await import('../../src/js/rust-shelf.js');
  const production = await import('../../src/js/book-model.js');
  const live = () => needRustShelf().shelf_live_handles();
  const cycle = async () => {
    const host = document.createElement('div'); document.body.append(host);
    const view = production.bookView(host, { ...book }, { ...style }, { width:132, height:200, thickness:40, viewportWidth:390, viewportHeight:844,
      centerX:195, centerY:350, initialPose:pose });
    view.draw(pose); view.setPageSnapshot(page(600, 900)); view.updateBookmark({ ...book, progress:.7 });
    view.updateAppearance({ ...style, color:'#18364b' });
    await view.prepareReturnAppearance({ ...book, title:'Again' }, { ...style, color:'#18364b' }, null);
    await view.prepareCoverRelief(); await view.setCoverRelief(null);
    await view.preparePagePrograms(callback => callback?.());
    const motion = view.animateCoverClose(); time.frames(60); await motion.finished;
    view.handoffToShelfInsertion(bridge => { bridge.cancel(); return null; });
    view.dispose(); host.remove();
  };
  for (let i = 0; i < 3; i++) await cycle();
  const before = live();
  for (let i = 0; i < 10; i++) await cycle();
  expect(live()).toBe(before);
}, 120_000);
