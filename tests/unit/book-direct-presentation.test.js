import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const gpu = vi.hoisted(() => ({ renderers:[], renders:[], imageLoads:[], failPresentation:false }));
vi.mock('three', async importOriginal => {
  const THREE = await importOriginal();
  class Renderer {
    constructor(options) {
      this.options = options; this.domElement = document.createElement('canvas');
      this.shadowMap = {}; this.info = { programs:[] };
      this.capabilities = { getMaxAnisotropy:() => 1 };
      this.size = new THREE.Vector2(); this.ratio = 1;
      gpu.renderers.push(this);
    }
    getContext() { return {}; }
    getSize(target) { return target.copy(this.size); }
    setSize(width, height) {
      this.size.set(width, height); this.domElement.width = Math.floor(width * this.ratio);
      this.domElement.height = Math.floor(height * this.ratio);
    }
    getPixelRatio() { return this.ratio; }
    setPixelRatio(value) { this.ratio = value; this.setSize(this.size.x, this.size.y); }
    compile() {}
    render(scene, camera) {
      const model = scene.children.find(object => object.isGroup);
      const frame = { scene:scene.uuid, angle:THREE.MathUtils.radToDeg(model.rotation.y),
        scale:model.scale.x, position:model.position.toArray(), ratio:this.ratio,
        dimensions:this.size.toArray(), viewOffset:camera.view?.enabled ? { ...camera.view } : null };
      this.domElement.frame = structuredClone(frame);
      gpu.renders.push({ renderer:this, frame, model });
    }
    dispose() { this.disposed = true; }
  }
  class PMREM {
    constructor(renderer) { this.renderer = renderer; }
    fromScene() {
      if (gpu.failPresentation && this.renderer.options.preserveDrawingBuffer) throw new Error('Second context unavailable');
      return { texture:new THREE.Texture() };
    }
    dispose() {}
  }
  class TextureLoader {
    load(url, onLoad, _onProgress, onError) {
      const texture = new THREE.Texture();
      gpu.imageLoads.push({ url, texture, onLoad, onError });
      return texture;
    }
  }
  return { ...THREE, WebGLRenderer:Renderer, PMREMGenerator:PMREM, TextureLoader };
});

let contexts, views, bookView;
class Context {
  constructor(canvas) { this.canvas = canvas; this.frame = null; this.copies = []; }
  drawImage(source, ...args) {
    this.frame = structuredClone(source.frame || contexts.get(source)?.frame || null);
    this.copies.push({ source, args, frame:structuredClone(this.frame) });
  }
  clearRect() { this.frame = null; }
  measureText(text) { return { width:String(text).length * 16 }; }
  createLinearGradient() { return { addColorStop() {} }; }
  getImageData(_x, _y, width, height) {
    return { data:new Uint8ClampedArray(width * height * 4), frame:structuredClone(this.frame) };
  }
  fillRect() {} strokeRect() {} fillText() {} strokeText() {} beginPath() {} closePath() {} rect() {} roundRect() {}
  moveTo() {} lineTo() {} quadraticCurveTo() {} bezierCurveTo() {} arc() {} ellipse() {}
  fill() {} stroke() {} save() {} restore() {} translate() {} scale() {} rotate() {} setTransform() {}
  clip() {} putImageData() {}
}

beforeEach(async () => {
  vi.resetModules(); contexts = new WeakMap(); views = [];
  gpu.renderers.length = 0; gpu.renders.length = 0; gpu.imageLoads.length = 0; gpu.failPresentation = false;
  vi.stubGlobal('WebGLRenderingContext', function WebGLRenderingContext() {});
  vi.stubGlobal('devicePixelRatio', 2);
  // Each test gets a fresh native method before the production source-aware
  // drawImage hook is installed. Only the driver and canvas pixels are faked;
  // the actual model, camera, page, ribbon and presentation ownership run.
  class TestContext extends Context { drawImage(...args) { return super.drawImage(...args); } }
  vi.stubGlobal('CanvasRenderingContext2D', TestContext);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function(type) {
    if (type !== '2d') return null;
    if (!contexts.has(this)) contexts.set(this, new Proxy(new TestContext(this), {
      get:(target, key) => key in target ? Reflect.get(target, key) : () => {}
    }));
    return contexts.get(this);
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(function() {
    return JSON.stringify(contexts.get(this)?.frame || null);
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function(callback) {
    callback(new Blob([JSON.stringify(contexts.get(this)?.frame || null)], { type:'image/mock' }));
  });
  ({ bookView } = await import('../../src/js/book-model.js'));
});
afterEach(() => {
  for (const view of views) view.dispose();
  document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

const pose = { x:0, y:0, scale:1, angle:0, pitch:0, roll:0, coverOpen:1, bookmarkWithdraw:1, pageTheme:1 };
function make(options = {}) {
  const stage = document.createElement('div'); stage.className = 'test-stage'; stage.style.position = 'relative';
  const host = document.createElement('div'); stage.append(host); document.body.append(stage);
  const view = bookView(host, { id:`direct:${views.length}`, title:'Actual Book', author:'Reader', format:'PDF' },
    { color:'#42604b', shade:'#324c3a', ink:'#ffffff', coverRatio:.66, width:40 },
    { width:132, height:200, thickness:40, viewportWidth:390, viewportHeight:844,
      centerX:195, centerY:350, initialPose:pose, deferDraw:true, ...options });
  expect(view).not.toBeNull(); views.push(view);
  vi.spyOn(view.canvas, 'getBoundingClientRect').mockReturnValue({ left:3, top:7, width:390, height:844, right:393, bottom:851 });
  return { view, host, stage };
}
const output = view => contexts.get(view.canvas);
const presentation = () => gpu.renderers.find(renderer => renderer.options.preserveDrawingBuffer);
const copies = view => output(view).copies.filter(copy => copy.source === presentation()?.domElement);

describe('direct book presentation and actual lazy snapshots', () => {
  it('uses a fixed smaller pixel-aligned window for a closed desktop book and retains full-size exports', () => {
    const { view } = make({ viewportWidth:1280, viewportHeight:900, compactReturnFrame:true });
    vi.mocked(view.canvas.getBoundingClientRect).mockReturnValue({ left:3,top:7,width:1280,height:900,right:1283,bottom:907 });
    for (const angle of [0,25,65,90]) {
      view.draw({ ...pose,coverOpen:0,angle });
      expect(gpu.renders.at(-1).frame.dimensions).toEqual([320,384]);
      expect(gpu.renders.at(-1).frame.ratio).toBe(2);
      expect(gpu.renders.at(-1).frame.viewOffset.fullWidth).toBe(1280);
      expect(gpu.renders.at(-1).frame.viewOffset.fullHeight).toBe(900);
    }
    expect(copies(view)).toHaveLength(0);
    expect(view.canvas.width).toBe(2560); expect(view.canvas.height).toBe(1800);
    view.canvas.getContext('2d');
    expect(copies(view)).toHaveLength(1);
    expect(copies(view)[0].args).toHaveLength(2);
  });

  it('expands the camera window for the real open cover and uses the original full window during page zoom', () => {
    const { view } = make({ viewportWidth:1280,viewportHeight:900,compactReturnFrame:true });
    view.draw({ ...pose,coverOpen:0 });
    expect(gpu.renders.at(-1).frame.dimensions).toEqual([320,384]);
    view.draw(pose);
    expect(gpu.renders.at(-1).frame.dimensions).toEqual([448,384]);
    view.draw({ ...pose,scale:2 });
    expect(gpu.renders.at(-1).frame.dimensions).toEqual([1280,900]);
    expect(gpu.renders.at(-1).frame.viewOffset).toBeNull();
    expect(copies(view)).toHaveLength(0);
  });

  it('presents successive poses through one live GPU canvas while keeping one export canvas inside the book', () => {
    const { view, host, stage } = make();
    for (const angle of [0, 20, 65]) view.draw({ ...pose, angle });
    expect(gpu.renderers).toHaveLength(2); expect(gpu.renders).toHaveLength(3);
    expect(copies(view)).toHaveLength(0);
    expect(host.querySelectorAll('canvas')).toHaveLength(1);
    expect(stage.querySelectorAll('.ihr-book-live-canvas')).toHaveLength(1);
    expect(presentation().domElement.parentElement).toBe(stage);
    expect(view.canvas.style.opacity).toBe('0'); expect(view.canvas.width).toBe(780);
    expect(view.canvas.height).toBe(1688); expect(view.canvas.dataset.angle).toBe('65');
  });

  it('captures the latest actual displayed frame only once when its 2D context is requested', () => {
    const { view } = make(); view.draw({ ...pose, angle:42 });
    const rendered = structuredClone(presentation().domElement.frame), before = gpu.renders.length;
    expect(output(view).frame).toBeNull();
    expect(view.canvas.getContext('2d').frame).toEqual(rendered);
    expect(copies(view)).toHaveLength(1); expect(gpu.renders).toHaveLength(before);
    expect(view.canvas.getContext('2d').frame).toEqual(rendered);
    expect(copies(view)).toHaveLength(1);
  });

  it('captures the actual current frame when a previously retained 2D context reads pixels', () => {
    const { view } = make(); view.draw({ ...pose, angle:17 });
    const retained = view.canvas.getContext('2d');
    view.draw({ ...pose, angle:73 });
    const displayed = structuredClone(presentation().domElement.frame), before = gpu.renders.length;
    expect(retained.frame.angle).toBeCloseTo(17);
    expect(retained.getImageData(0, 0, 1, 1).frame).toEqual(displayed);
    expect(copies(view)).toHaveLength(2); expect(gpu.renders).toHaveLength(before);
    expect(retained.getImageData(0, 0, 1, 1).frame).toEqual(displayed);
    expect(copies(view)).toHaveLength(2);
  });

  it('keeps toDataURL and toBlob exports current without replaying an already displayed frame', async () => {
    const { view } = make(); view.draw({ ...pose, angle:24 });
    expect(JSON.parse(view.canvas.toDataURL())).toEqual(presentation().domElement.frame);
    view.draw({ ...pose, angle:60 });
    const expected = structuredClone(presentation().domElement.frame), before = gpu.renders.length;
    const blob = await new Promise(resolve => view.canvas.toBlob(resolve));
    expect(JSON.parse(new TextDecoder().decode(await blob.arrayBuffer()))).toEqual(expected);
    expect(copies(view)).toHaveLength(2); expect(gpu.renders).toHaveLength(before);
  });

  it('materializes a lazy canvas before another canvas draws it, as the original pixel observers do', () => {
    const { view } = make(); view.draw({ ...pose, angle:31 });
    const observer = document.createElement('canvas'), ctx = observer.getContext('2d');
    ctx.drawImage(view.canvas, 0, 0, 160, 346);
    expect(ctx.frame).toEqual(presentation().domElement.frame);
    expect(copies(view)).toHaveLength(1);
  });

  it('retains displayed pixels when a deferred pose prepares geometry without committing a new frame', () => {
    const { view } = make(); view.draw({ ...pose, angle:17 });
    const displayed = structuredClone(presentation().domElement.frame), before = gpu.renders.length;
    view.draw({ ...pose, angle:73 }, { redraw:false });
    expect(gpu.renders).toHaveLength(before); expect(copies(view)).toHaveLength(1);
    expect(JSON.parse(view.canvas.toDataURL())).toEqual(displayed);
    expect(presentation().domElement.frame).toEqual(displayed);
    view.draw({ ...pose, angle:73 });
    expect(presentation().domElement.frame.angle).toBeCloseTo(73);
    expect(JSON.parse(view.canvas.toDataURL()).angle).toBeCloseTo(73);
  });

  it('applies an asynchronous appearance replacement at the current pose without painting before the first explicit draw', async () => {
    const { view, host, stage } = make({ coverUrl:'blob:deferred-cover' }); host.remove();
    const originalReady = view.ready;
    view.draw({ ...pose, angle:46, x:12, y:9, scale:.7 }, { redraw:false });
    expect(view.updateAppearance({ color:'#243c5d', shade:'#172e4a', ink:'#ffffff', coverRatio:.66 })).toBe(true);
    const replacementReady = view.ready;
    expect(gpu.imageLoads).toHaveLength(1);
    const load = gpu.imageLoads[0];
    load.texture.image = Object.assign(document.createElement('canvas'), { width:144, height:218 });
    load.onLoad(load.texture);
    await Promise.all([originalReady, replacementReady]); await Promise.resolve();
    expect(gpu.renders).toHaveLength(0); expect(copies(view)).toHaveLength(0);
    expect(view.getPose()).toMatchObject({ angle:46, x:12, y:9, scale:.7 });
    stage.append(host); view.draw(view.getPose());
    expect(gpu.renders).toHaveLength(1); expect(presentation().domElement.frame.angle).toBeCloseTo(46);
    expect(presentation().domElement.frame.scale).toBeCloseTo(.7);
    expect(presentation().domElement.frame.position).toEqual([12, 63, 0]);
  });

  it('defers implicit spine, cover, edge, bookmark and relief updates until the first explicit draw', async () => {
    const { view } = make();
    expect(view.updateSpineAppearance({ title:'Updated spine' },
      { color:'#243c5d', shade:'#172e4a', ink:'#ffffff', coverRatio:.66 })).toBe(true);
    expect(view.updateCoverAppearance({ coverFinish:'glossy' })).toBe(true);
    expect(view.updateEdgeAppearance({ pageEdgeFinish:'glossy' })).toBe(true);
    expect(view.updateBookmark({ progressFraction:.25 })).toBe(true);
    expect(await view.prepareCoverRelief()).toBe(true);
    expect(await view.setCoverRelief(null)).toBe(true);
    expect(gpu.renders).toHaveLength(0); expect(copies(view)).toHaveLength(0);
    view.draw(view.getPose());
    expect(gpu.renders).toHaveLength(1); expect(presentation().domElement.frame.angle).toBeCloseTo(0);
  });

  it('retains the actual displayed frame while a deferred appearance update prepares a later pose', () => {
    const { view } = make(); view.draw({ ...pose, angle:17 });
    const displayed = structuredClone(presentation().domElement.frame);
    view.deferDrawing(); view.draw({ ...pose, angle:73 }, { redraw:false });
    expect(view.updateAppearance({ color:'#243c5d', shade:'#172e4a', ink:'#ffffff', coverRatio:.66 })).toBe(true);
    view.updateCoverAppearance({ coverFinish:'matte' }); view.updateEdgeAppearance({ pageEdgeFinish:'matte' });
    expect(gpu.renders).toHaveLength(1); expect(JSON.parse(view.canvas.toDataURL())).toEqual(displayed);
    expect(presentation().domElement.frame).toEqual(displayed); expect(view.getPose().angle).toBe(73);
    view.draw(view.getPose());
    expect(gpu.renders).toHaveLength(2); expect(JSON.parse(view.canvas.toDataURL()).angle).toBeCloseTo(73);
  });

  it('draws unchanged opaque paper and stock before physical cases while retaining page projection and blending', () => {
    const { view } = make();
    const source = Object.assign(document.createElement('canvas'), { width:144, height:218 });
    const stock = Object.assign(document.createElement('canvas'), { width:144, height:218 });
    expect(view.setPageSnapshot({ source, width:144, height:218,
      paper:{ source:stock, width:144, height:218 } }, { pageTheme:0, redraw:false })).toBe(true);
    view.draw({ ...pose, pageTheme:0 });
    const model = gpu.renders.at(-1).model;
    const paper = model.getObjectByName('reading-page-paper'), white = model.getObjectByName('reading-page-stock');
    const themed = model.getObjectByName('reading-page');
    expect(paper.renderOrder).toBe(-2); expect(white.renderOrder).toBe(-1);
    for (const name of ['front-cover', 'back-cover', 'page-block', 'binding', 'read-leaves']) {
      expect(paper.renderOrder).toBeLessThan(model.getObjectByName(name).renderOrder);
      expect(white.renderOrder).toBeLessThan(model.getObjectByName(name).renderOrder);
    }
    for (const mesh of [paper, white]) {
      expect(mesh.material.isMeshBasicMaterial).toBe(true); expect(mesh.material.transparent).toBe(false);
      expect(mesh.material.depthTest).toBe(true); expect(mesh.material.depthWrite).toBe(true);
      expect(mesh.visible).toBe(true);
    }
    const pageGeometry = themed.geometry, stockGeometry = white.geometry;
    expect(themed.visible).toBe(true); expect(themed.material.transparent).toBe(true);
    expect(themed.material.opacity).toBe(0); expect(view.getPageBounds()).not.toBeNull();
    view.draw({ ...pose, pageTheme:.5 });
    expect(themed.material.opacity).toBe(.5); expect(themed.material.transparent).toBe(true);
    expect(themed.geometry).toBe(pageGeometry); expect(white.geometry).toBe(stockGeometry);
    expect(paper.renderOrder).toBe(-2); expect(white.renderOrder).toBe(-1);
  });

  it('saves the previous owners pixels once before transferring the live canvas to the next book', () => {
    const first = make(); first.view.draw({ ...pose, angle:17 });
    const firstFrame = structuredClone(presentation().domElement.frame);
    const second = make(); second.view.draw({ ...pose, angle:73 });
    expect(output(first.view).frame).toEqual(firstFrame); expect(copies(first.view)).toHaveLength(1);
    expect(first.view.canvas.style.opacity).toBe(''); expect(second.view.canvas.style.opacity).toBe('0');
    expect(first.stage.querySelector('.ihr-book-live-canvas')).toBeNull();
    expect(presentation().domElement.parentElement).toBe(second.stage);
    const before = gpu.renders.length;
    expect(JSON.parse(first.view.canvas.toDataURL())).toEqual(firstFrame);
    expect(gpu.renders).toHaveLength(before); expect(copies(first.view)).toHaveLength(1);
  });

  it('restores the active owners GPU pixels after rendering an updated detached retained book', () => {
    const first = make(); first.view.draw({ ...pose, angle:17 });
    const second = make(); second.view.draw({ ...pose, angle:73 });
    const activeFrame = structuredClone(presentation().domElement.frame);
    first.host.remove(); first.view.draw({ ...pose, angle:46 });
    expect(output(first.view).frame.angle).toBeCloseTo(46);
    expect(presentation().domElement.frame).toEqual(activeFrame);
    expect(presentation().domElement.parentElement).toBe(second.stage);
    expect(second.view.canvas.style.opacity).toBe('0');
  });

  it('positions a retained view using the export canvases new parent after the reader closes', () => {
    const first = make(); first.view.draw({ ...pose, angle:17 });
    const returnStage = document.createElement('div'), returnHost = document.createElement('div');
    returnStage.style.position = 'relative'; returnStage.append(returnHost); document.body.append(returnStage);
    returnHost.append(first.view.canvas); first.host.remove();
    first.view.draw({ ...pose, angle:73 });
    expect(presentation().domElement.parentElement).toBe(returnStage);
    expect(returnHost.querySelectorAll('canvas')).toHaveLength(1);
    expect(first.stage.querySelector('.ihr-book-live-canvas')).toBeNull();
    expect(first.view.canvas.style.opacity).toBe('0');
  });

  it('copies the original fractional-DPR resampling into its complete output rather than presenting a shifted pixel window', () => {
    vi.stubGlobal('devicePixelRatio', 1.25);
    const { view, stage } = make({ compactReturnFrame:true }); view.draw(pose);
    expect(view.canvas.width).toBe(488); expect(view.canvas.height).toBe(1055);
    expect(presentation().domElement.frame.ratio).toBe(1.25);
    expect(presentation().domElement.frame.dimensions).toEqual([390, 844]);
    expect(presentation().domElement.frame.viewOffset).toBeNull();
    expect(stage.querySelector('.ihr-book-live-canvas')).toBeNull();
    expect(view.canvas.style.opacity).toBe('');
    expect(copies(view)).toHaveLength(1); expect(copies(view)[0].args).toEqual([0, 0, 488, 1055]);
  });

  it('returns the current frame to its retained 2D canvas before shared-depth insertion', () => {
    const { view, stage } = make(); view.draw({ ...pose, angle:90 });
    const displayed = structuredClone(presentation().domElement.frame);
    view.releaseToSnapshot();
    expect(output(view).frame).toEqual(displayed); expect(copies(view)).toHaveLength(1);
    expect(stage.querySelector('.ihr-book-live-canvas')).toBeNull(); expect(view.canvas.style.opacity).toBe('');
    view.draw({ ...pose, angle:65 });
    expect(stage.querySelector('.ihr-book-live-canvas')).toBeNull();
    expect(output(view).frame.angle).toBeCloseTo(65);
  });

  it('keeps a resumable depth handoff on its snapshot until the output canvas actually changes parents', () => {
    const { view, host, stage } = make(); view.draw({ ...pose, angle:90 });
    view.releaseToSnapshot({ resume:true });
    view.draw({ ...pose, angle:65 });
    expect(stage.querySelector('.ihr-book-live-canvas')).toBeNull();
    expect(view.canvas.style.opacity).toBe(''); expect(output(view).frame.angle).toBeCloseTo(65);
    const returnStage = document.createElement('div'), returnHost = document.createElement('div');
    returnStage.style.position = 'relative'; returnStage.append(returnHost); document.body.append(returnStage);
    returnHost.append(view.canvas); host.remove();
    view.draw({ ...pose, angle:42 });
    expect(presentation().domElement.parentElement).toBe(returnStage);
    expect(view.canvas.style.opacity).toBe('0'); expect(presentation().domElement.frame.angle).toBeCloseTo(42);
  });

  it('preserves an actual export when disposal retains the output canvas and reuses one presentation renderer', () => {
    const first = make(); first.view.draw({ ...pose, angle:12 });
    const displayed = structuredClone(presentation().domElement.frame), renderer = presentation();
    first.view.dispose(false);
    expect(first.view.canvas.isConnected).toBe(true); expect(output(first.view).frame).toEqual(displayed);
    expect(first.stage.querySelector('.ihr-book-live-canvas')).toBeNull();
    const before = gpu.renders.length; first.view.draw({ ...pose, angle:70 });
    expect(gpu.renders).toHaveLength(before);
    const second = make(); second.view.draw({ ...pose, angle:33 });
    expect(presentation()).toBe(renderer); expect(gpu.renderers).toHaveLength(2);
  });

  it('does not remove another owners live canvas when an older retained view is disposed', () => {
    const first = make(); first.view.draw({ ...pose, angle:12 });
    const second = make(); second.view.draw({ ...pose, angle:33 });
    first.view.dispose();
    expect(first.view.canvas.isConnected).toBe(false);
    expect(presentation().domElement.parentElement).toBe(second.stage);
    expect(second.view.canvas.style.opacity).toBe('0');
  });

  it('falls back to the existing snapshot renderer if a dedicated context cannot initialize', () => {
    gpu.failPresentation = true;
    const { view, stage } = make(); view.draw({ ...pose, angle:12 });
    expect(stage.querySelector('.ihr-book-live-canvas')).toBeNull(); expect(view.canvas.style.opacity).toBe('');
    expect(gpu.renders.at(-1).renderer).toBe(gpu.renderers[0]);
    expect(output(view).frame.angle).toBeCloseTo(12);
  });
});
