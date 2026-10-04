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

let contexts, views, bookView, broker;
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
  broker = await import('../../src/js/native-renderer-presentation.js');
});
afterEach(() => {
  for (const view of views) view.dispose();
  document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

const pose = { x:0, y:0, scale:1, angle:0, pitch:0, roll:0, coverOpen:1, bookmarkWithdraw:1, pageTheme:1 };
function make(options = {}, extraBook = {}) {
  const stage = document.createElement('div'); stage.className = 'test-stage'; stage.style.position = 'relative';
  const host = document.createElement('div'); stage.append(host); document.body.append(stage);
  const view = bookView(host, { id:`direct:${views.length}`, title:'Actual Book', author:'Reader', format:'PDF', ...extraBook },
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

let frameClock,frameQueue,frameSerial;
function clock() {
  frameClock=0;frameQueue=new Map();frameSerial=0;
  vi.spyOn(performance,'now').mockImplementation(()=>frameClock);
  vi.stubGlobal('requestAnimationFrame',callback=>{const id=++frameSerial;frameQueue.set(id,callback);return id;});
  vi.stubGlobal('cancelAnimationFrame',id=>frameQueue.delete(id));
}
async function step(delta=200) {
  frameClock+=delta;const entry=frameQueue.entries().next().value;
  expect(entry).toBeDefined();frameQueue.delete(entry[0]);entry[1](frameClock);await Promise.resolve();
}
function start(extraBook={}) {
  clock();const initial={...pose,bookmarkWithdraw:0};
  const {view}=make({initialPose:initial},extraBook);view.draw(initial);
  const model=gpu.renders.at(-1).model;
  gpu.renders.length=0;output(view).copies=[];
  return {view,model,initial};
}

describe('bookmark motion without a physical ribbon keeps its clock and visible frame',()=>{
  it('advances the original capped clock and logical state without rendering or snapshot readbacks',async()=>{
    const {view,model,initial}=start();expect(model.userData.hasBookmark).toBe(false);
    const motion=view.animateBookmark({withdraw:1,duration:320});let finished=false;
    motion.finished.then(()=>{finished=true;});
    for(const elapsed of [48,148,248]) {
      await step();expect(finished).toBe(false);
      const fraction=elapsed/320,expected=3*fraction*fraction-2*fraction*fraction*fraction;
      expect(view.getPose().bookmarkWithdraw).toBeCloseTo(expected,12);
      expect(Number(view.canvas.dataset.bookmarkWithdraw)).toBeCloseTo(expected,12);
      const {bookmarkWithdraw:_withdraw,...visible}=initial;
      expect(view.getPose()).toMatchObject(visible);
      expect(gpu.renders).toHaveLength(0);expect(output(view).copies).toHaveLength(0);
    }
    await step();await motion.finished;expect(finished).toBe(true);
    expect(view.getPose().bookmarkWithdraw).toBe(1);expect(view.canvas.dataset.bookmarkWithdraw).toBe('1');
    expect(frameQueue.size).toBe(0);expect(gpu.renders).toHaveLength(0);expect(output(view).copies).toHaveLength(0);
    expect(presentation().domElement.isConnected).toBe(true);
    view.canvas.getContext('2d');expect(copies(view)).toHaveLength(1);
  });
  it('cancels on the original promise path while retaining partial logical withdrawal',async()=>{
    const {view}=start(),motion=view.animateBookmark({withdraw:1,duration:320});
    await step();await step();const partial=view.getPose().bookmarkWithdraw;motion.cancel();await motion.finished;
    expect(partial).toBeGreaterThan(0);expect(partial).toBeLessThan(1);
    expect(view.getPose().bookmarkWithdraw).toBe(partial);expect(frameQueue.size).toBe(0);
    expect(gpu.renders).toHaveLength(0);expect(output(view).copies).toHaveLength(0);
  });
  it('keeps the original real ribbon rendering when a bookmark exists from the start',async()=>{
    const {view,model}=start({progressFraction:.5});expect(model.getObjectByName('reading-bookmark')).toBeDefined();
    const motion=view.animateBookmark({withdraw:1,duration:320});
    for(let index=0;index<4;index++)await step();await motion.finished;
    expect(gpu.renders).toHaveLength(4);expect(model.getObjectByName('reading-bookmark').visible).toBe(false);
    expect(view.getPose().bookmarkWithdraw).toBe(1);
  });
  it('falls back to a real draw when a bookmark appears during the phase',async()=>{
    const {view,model}=start(),motion=view.animateBookmark({withdraw:1,duration:320});
    await step();expect(gpu.renders).toHaveLength(0);
    view.updateBookmark({progressFraction:.5});expect(model.getObjectByName('reading-bookmark')).toBeDefined();
    expect(gpu.renders).toHaveLength(1);gpu.renders.length=0;
    await step();expect(gpu.renders).toHaveLength(1);
    await step();await step();await motion.finished;expect(gpu.renders).toHaveLength(3);
  });
  it('does not trust a stale false flag when an actual ribbon mesh is still present',async()=>{
    const {view,model}=start({progressFraction:.5});model.userData.hasBookmark=false;
    expect(model.getObjectByName('reading-bookmark')).toBeDefined();
    const motion=view.animateBookmark({withdraw:1,duration:320});await step();
    expect(gpu.renders).toHaveLength(1);motion.cancel();await motion.finished;
  });
  it('preserves the original drawing behavior when an external visible pose changes during the phase',async()=>{
    const {view}=start(),motion=view.animateBookmark({withdraw:1,duration:320});await step();
    view.draw({...view.getPose(),x:12});gpu.renders.length=0;await step();
    expect(gpu.renders).toHaveLength(1);expect(view.getPose().x).toBe(0);
    motion.cancel();await motion.finished;
  });
  it('never intercepts legitimate page and material invalidations between identical bookmark ticks',async()=>{
    const {view,model}=start(),motion=view.animateBookmark({withdraw:1,duration:320});await step();
    const source=document.createElement('canvas');source.width=200;source.height=300;
    expect(view.setPageSnapshot({source,width:200,height:300,sourceType:'actual-page'}, {pageTheme:1})).toBe(true);
    expect(gpu.renders).toHaveLength(1);model.userData.invalidate();expect(gpu.renders).toHaveLength(2);
    gpu.renders.length=0;await step();expect(gpu.renders).toHaveLength(0);
    expect(view.canvas.dataset.pageSource).toBe('actual-page');motion.cancel();await motion.finished;
  });
  it('paints the first real frame when setup has not committed any presentation yet',async()=>{
    clock();const {view}=make({initialPose:{...pose,bookmarkWithdraw:0},deferDraw:true});
    expect(gpu.renders).toHaveLength(0);const motion=view.animateBookmark({withdraw:1,duration:320});
    await step();expect(gpu.renders).toHaveLength(1);expect(presentation().domElement.isConnected).toBe(true);
    motion.cancel();await motion.finished;
  });

  it('restores a native frame after another actual book takes presentation ownership',async()=>{
    const {view,model}=start();const other=make().view;other.draw({...pose,angle:24});
    expect(presentation().domElement.parentElement).toBe(other.canvas.parentElement.parentElement);
    gpu.renders.length=0;output(view).copies=[];
    const motion=view.animateBookmark({withdraw:1,duration:320});await step();
    expect(gpu.renders).toHaveLength(1);expect(gpu.renders[0].model).toBe(model);
    expect(presentation().domElement.parentElement).toBe(view.canvas.parentElement.parentElement);
    expect(view.canvas.style.opacity).toBe('0');motion.cancel();await motion.finished;
  });
  it('reattaches a detached native framebuffer instead of skipping its first restore',async()=>{
    const {view}=start();presentation().domElement.remove();
    const motion=view.animateBookmark({withdraw:1,duration:320});await step();
    expect(gpu.renders).toHaveLength(1);expect(presentation().domElement.isConnected).toBe(true);
    motion.cancel();await motion.finished;
  });
  it('keeps the original pending external handoff state without falsely advancing its book pose',async()=>{
    const {view}=start();let bridge;
    const handle={finished:Promise.resolve(),cancel(){}};
    expect(view.handoffToShelfInsertion(value=>{bridge=value;return handle;})).toBe(handle);
    const motion=view.animateBookmark({withdraw:1,duration:320});await step();
    expect(view.getPose().bookmarkWithdraw).toBe(0);expect(view.canvas.dataset.bookmarkWithdraw).toBe('0');
    expect(gpu.renders).toHaveLength(0);expect(presentation().domElement.isConnected).toBe(true);
    bridge.cancel();motion.cancel();await motion.finished;
  });
  it('uses the original draw when an actual model has an unknown bookmark flag',async()=>{
    const {view,model}=start();delete model.userData.hasBookmark;
    const motion=view.animateBookmark({withdraw:1,duration:320});await step();
    expect(gpu.renders).toHaveLength(1);motion.cancel();await motion.finished;
  });
  it('uses the original draw while a cold appearance replacement is pending',async()=>{
    clock();const initial={...pose,bookmarkWithdraw:0};
    const {view}=make({initialPose:initial,coverUrl:'blob:pending-cover'});view.draw(initial);
    expect(view.updateAppearance({color:'#293f61',shade:'#293344',ink:'#ffffff',coverRatio:.66,width:40})).toBe(true);
    gpu.renders.length=0;output(view).copies=[];
    const motion=view.animateBookmark({withdraw:1,duration:320});await step();
    expect(gpu.renders).toHaveLength(1);motion.cancel();await motion.finished;
  });
  it('paints a page installed without redraw before retaining any identical bookmark frame',async()=>{
    const {view}=start();const source=document.createElement('canvas');source.width=200;source.height=300;
    expect(view.setPageSnapshot({source,width:200,height:300,sourceType:'unpainted-page'}, {redraw:false})).toBe(true);
    expect(gpu.renders).toHaveLength(0);
    const motion=view.animateBookmark({withdraw:1,duration:320});await step();
    expect(gpu.renders).toHaveLength(1);expect(view.canvas.dataset.pageSource).toBe('unpainted-page');
    motion.cancel();await motion.finished;
  });
  it('paints a visible pose prepared without redraw before retaining its new frame',async()=>{
    const {view}=start();view.draw({...view.getPose(),x:17},{redraw:false});
    expect(gpu.renders).toHaveLength(0);
    const motion=view.animateBookmark({withdraw:1,duration:320});await step();
    expect(gpu.renders).toHaveLength(1);expect(view.getPose().x).toBe(17);
    motion.cancel();await motion.finished;
  });
  it('keeps the original legacy 2D rendering and copy behavior',async()=>{
    clock();const initial={...pose,bookmarkWithdraw:0};
    const {view}=make({initialPose:initial,directPresentation:false});view.draw(initial);
    expect(view.canvas.style.opacity).toBe('');gpu.renders.length=0;output(view).copies=[];
    const motion=view.animateBookmark({withdraw:1,duration:320});
    for(let index=0;index<4;index++)await step();await motion.finished;
    expect(view.getPose().bookmarkWithdraw).toBe(1);expect(gpu.renders).toHaveLength(4);
    expect(output(view).copies).toHaveLength(4);expect(view.canvas.style.opacity).toBe('');
  });

  it('repaints a same-object snapshot whose theme or pixels were prepared without redraw',async()=>{
    const {view}=start();const source=document.createElement('canvas');source.width=200;source.height=300;
    const snapshot={source,width:200,height:300,sourceType:'same-page'};
    expect(view.setPageSnapshot(snapshot,{pageTheme:1})).toBe(true);gpu.renders.length=0;
    const motion=view.animateBookmark({withdraw:1,duration:320});
    expect(view.setPageSnapshot(snapshot,{pageTheme:0,redraw:false})).toBe(true);
    expect(gpu.renders).toHaveLength(0);await step();expect(gpu.renders).toHaveLength(1);
    expect(view.getPose().pageTheme).toBe(1);expect(view.canvas.dataset.pageTheme).toBe('1');
    gpu.renders.length=0;expect(view.setPageSnapshot(snapshot,{redraw:false})).toBe(true);
    await step();expect(gpu.renders).toHaveLength(1);
    motion.cancel();await motion.finished;
  });
  it('removes a painted ribbon on the first real frame after a blocked update and handoff cancellation',async()=>{
    const {view,model}=start({progressFraction:.5});expect(model.getObjectByName('reading-bookmark')).toBeDefined();
    let bridge;const handle={finished:Promise.resolve(),cancel(){}};
    expect(view.handoffToShelfInsertion(value=>{bridge=value;return handle;})).toBe(handle);
    expect(view.updateBookmark({progressFraction:0})).toBe(true);
    expect(model.userData.hasBookmark).toBe(false);expect(model.getObjectByName('reading-bookmark')).toBeUndefined();
    expect(gpu.renders).toHaveLength(0);bridge.cancel();
    const motion=view.animateBookmark({withdraw:1,duration:320});await step();
    expect(gpu.renders).toHaveLength(1);expect(gpu.renders[0].model).toBe(model);
    gpu.renders.length=0;await step();expect(gpu.renders).toHaveLength(0);
    motion.cancel();await motion.finished;
  });

  it('keeps native CSS placement current when the connected host moves and is reparented',async()=>{
    const {view}=start();const host=view.canvas.parentElement,newStage=document.createElement('div');
    document.body.append(newStage);newStage.append(host);
    vi.spyOn(newStage,'getBoundingClientRect').mockReturnValue({left:10,top:20,width:390,height:844});
    vi.mocked(view.canvas.getBoundingClientRect).mockReturnValue({left:40,top:50,width:390,height:844,right:430,bottom:894});
    const motion=view.animateBookmark({withdraw:1,duration:320});await step();
    const node=presentation().domElement;
    expect(node.parentElement).toBe(newStage);expect(node.style.left).toBe('30px');expect(node.style.top).toBe('30px');
    expect(node.style.width).toBe('390px');expect(node.style.height).toBe('844px');
    expect(gpu.renders).toHaveLength(0);expect(output(view).copies).toHaveLength(0);
    motion.cancel();await motion.finished;
  });
  it('forces normal drawing on context loss and restoration and removes its lifecycle listeners at disposal',async()=>{
    const {view}=start();const renderer=presentation(),node=renderer.domElement;let lost=true;
    renderer.getContext=()=>({isContextLost:()=>lost});
    node.dispatchEvent(new Event('webglcontextlost'));
    const motion=view.animateBookmark({withdraw:1,duration:320});await step();expect(gpu.renders).toHaveLength(1);
    lost=false;node.dispatchEvent(new Event('webglcontextrestored'));gpu.renders.length=0;
    await step();expect(gpu.renders).toHaveLength(1);gpu.renders.length=0;
    await step();expect(gpu.renders).toHaveLength(0);motion.cancel();await motion.finished;
    const remove=vi.spyOn(node,'removeEventListener');view.dispose();
    expect(remove).toHaveBeenCalledWith('webglcontextlost',expect.any(Function));
    expect(remove).toHaveBeenCalledWith('webglcontextrestored',expect.any(Function));
  });

  it('repaints blocked cover, spine and edge appearance after an uncommitted handoff is cancelled',async()=>{
    const {view,model}=start();let bridge;
    const oldRoughness=model.getObjectByName('front-cover').material[0].roughness;
    const handle={finished:Promise.resolve(),cancel(){}};
    expect(view.handoffToShelfInsertion(value=>{bridge=value;return handle;})).toBe(handle);
    expect(view.updateCoverAppearance({coverFinish:'matte'})).toBe(true);
    expect(model.getObjectByName('front-cover').material[0].roughness).not.toBe(oldRoughness);
    expect(view.updateSpineAppearance({title:'Updated Title'}, {color:'#293f61',shade:'#293344',ink:'#ffffff',coverRatio:.66,width:40})).toBe(true);
    expect(view.updateEdgeAppearance({pageEdgeFinish:'gold'})).toBe(true);
    expect(gpu.renders).toHaveLength(0);bridge.cancel();
    const motion=view.animateBookmark({withdraw:1,duration:320});await step();
    expect(gpu.renders).toHaveLength(1);expect(gpu.renders[0].model).toBe(model);
    gpu.renders.length=0;await step();expect(gpu.renders).toHaveLength(0);
    motion.cancel();await motion.finished;
  });
  it('repaints a replacement and late cover invalidation that settled under a blocked handoff',async()=>{
    clock();const initial={...pose,bookmarkWithdraw:0};
    const {view}=make({initialPose:initial,coverUrl:'blob:blocked-replacement'});view.draw(initial);
    const previous=gpu.renders.at(-1).model;let bridge;
    const dispose=vi.spyOn(previous.userData,'dispose');const handle={finished:Promise.resolve(),cancel(){}};
    expect(view.handoffToShelfInsertion(value=>{bridge=value;return handle;})).toBe(handle);
    expect(view.updateAppearance({color:'#293f61',shade:'#293344',ink:'#ffffff',coverRatio:.66,width:40})).toBe(true);
    const ready=view.ready;gpu.renders.length=0;output(view).copies=[];
    const load=gpu.imageLoads.findLast(item=>item.url==='blob:blocked-replacement');expect(load).toBeTruthy();
    load.texture.image={width:900,height:600};load.onLoad(load.texture);
    await ready;await Promise.resolve();expect(dispose).toHaveBeenCalledOnce();
    expect(gpu.renders).toHaveLength(0);bridge.cancel();
    const motion=view.animateBookmark({withdraw:1,duration:320});await step();
    expect(gpu.renders).toHaveLength(1);expect(gpu.renders[0].model).not.toBe(previous);
    expect(gpu.renders[0].model.userData.coverLoaded).toBe(true);
    gpu.renders.length=0;await step();expect(gpu.renders).toHaveLength(0);
    motion.cancel();await motion.finished;
  });

  it('restores pixels painted by a mutable consumer of the exposed legacy 2D canvas on the next tick',async()=>{
    clock();const initial={...pose,bookmarkWithdraw:0};
    const {view}=make({initialPose:initial,directPresentation:false});view.draw(initial);
    const actualFrame=structuredClone(output(view).frame);
    view.canvas.getContext('2d').frame={consumer:'arbitrary added pixels'};
    gpu.renders.length=0;output(view).copies=[];
    const motion=view.animateBookmark({withdraw:1,duration:320});await step();
    expect(gpu.renders).toHaveLength(1);expect(output(view).copies).toHaveLength(1);
    expect(output(view).frame).toEqual(actualFrame);expect(view.canvas.style.opacity).toBe('');
    motion.cancel();await motion.finished;
  });

  it('restores a mutable native export lazily after a skipped tick without an eager GPU draw or copy',async()=>{
    const {view}=start();view.canvas.getContext('2d');expect(copies(view)).toHaveLength(1);
    const actualFrame=structuredClone(output(view).frame);
    view.canvas.getContext('2d').frame={consumer:'arbitrary export pixels'};
    gpu.renders.length=0;output(view).copies=[];
    const motion=view.animateBookmark({withdraw:1,duration:320});await step();
    expect(gpu.renders).toHaveLength(0);expect(output(view).copies).toHaveLength(0);
    expect(output(view).frame).toEqual({consumer:'arbitrary export pixels'});
    view.canvas.toDataURL();expect(gpu.renders).toHaveLength(0);expect(copies(view)).toHaveLength(1);
    expect(output(view).frame).toEqual(actualFrame);
    motion.cancel();await motion.finished;
  });
});
