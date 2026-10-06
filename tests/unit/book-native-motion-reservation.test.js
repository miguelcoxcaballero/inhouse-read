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


const smallPose={...pose,scale:.55};
const realBook={width:176,height:420,thickness:40,compactReturnFrame:true};
describe('growing compact reservation across a complete book motion', () => {
  it('keeps the compact frame and grows only when the book needs more space', () => {
    const {view}=make({...realBook,adaptiveNativeFrame:true});view.draw(smallPose);
    const before=gpu.renders.length;
    const release=view.holdNativeMotionFrame();expect(gpu.renders).toHaveLength(before);
    view.draw(smallPose);expect(gpu.renders.at(-1).frame.dimensions).toEqual([256,320]);
    view.draw(pose);const large=gpu.renders.at(-1).frame.dimensions;
    expect(large[1]).toBeGreaterThan(320);expect(large[1]).toBeLessThan(844);
    view.draw({...smallPose,angle:90});const kept=gpu.renders.at(-1).frame;
    expect(kept.dimensions).toEqual(large);expect(kept.ratio).toBe(2);
    expect(kept.viewOffset).not.toBeNull();release();
  });
  it('keeps nested reservations until the last release and releases each token once', () => {
    const {view}=make({...realBook,adaptiveNativeFrame:true});view.draw(pose);
    const large=gpu.renders.at(-1).frame.dimensions;
    const first=view.holdNativeMotionFrame(),second=view.holdNativeMotionFrame();
    first();first();view.draw(smallPose);expect(gpu.renders.at(-1).frame.dimensions).toEqual(large);
    second();view.draw(smallPose);expect(gpu.renders.at(-1).frame.dimensions).toEqual([256,320]);
  });
  it('releases without resizing or drawing the already presented frame', () => {
    const {view}=make({...realBook,adaptiveNativeFrame:true});view.draw(pose);
    const release=view.holdNativeMotionFrame();view.draw(smallPose);
    const before=gpu.renders.length,width=presentation().domElement.width,height=presentation().domElement.height;
    release();expect(gpu.renders).toHaveLength(before);
    expect(presentation().domElement.width).toBe(width);expect(presentation().domElement.height).toBe(height);
    view.draw(smallPose);expect(gpu.renders.at(-1).frame.dimensions).toEqual([256,320]);
  });
  it('keeps the reservation when an individual animation is cancelled', () => {
    const {view}=make({...realBook,adaptiveNativeFrame:true});view.draw(pose);
    const large=gpu.renders.at(-1).frame.dimensions;
    const release=view.holdNativeMotionFrame();
    const motion=view.animate([{transform:smallPose},{transform:{...smallPose,angle:20}}],{duration:300});
    motion.cancel();view.draw(smallPose);expect(gpu.renders.at(-1).frame.dimensions).toEqual(large);
    release();view.draw(smallPose);expect(gpu.renders.at(-1).frame.dimensions).toEqual([256,320]);
  });
  it('leaves legacy presentation unchanged even when a reservation is requested', () => {
    const {view}=make({...realBook,adaptiveNativeFrame:true,directPresentation:false});
    const release=view.holdNativeMotionFrame();view.draw(smallPose);
    expect(presentation()).toBeUndefined();expect(gpu.renders.at(-1).frame.dimensions).toEqual([390,704]);release();
  });
  it('preserves the original adaptive default without a reservation', () => {
    const {view}=make({...realBook,adaptiveNativeFrame:true});view.draw(smallPose);
    expect(gpu.renders.at(-1).frame.dimensions).toEqual([256,320]);expect(gpu.renders.at(-1).frame.ratio).toBe(2);
  });
  it('preserves the original fixed frame when adaptive mode is omitted', () => {
    const {view}=make(realBook);view.draw(smallPose);
    expect(gpu.renders.at(-1).frame.dimensions).toEqual([390,704]);expect(gpu.renders.at(-1).frame.ratio).toBe(2);
  });
});
