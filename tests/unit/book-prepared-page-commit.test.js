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


const closed = { ...pose, coverOpen:0, bookmarkWithdraw:0, pageTheme:1 };
function page(stock=true) {
  const source=document.createElement('canvas'); source.width=132; source.height=200;
  const paper=document.createElement('canvas'); paper.width=132; paper.height=200;
  return { source,width:132,height:200,sourceType:'pdf-original',engine:'pdf',text:'Actual page',
    background:'#222222', ...(stock ? {paper:{source:paper,background:'#ffffff'}} : {}) };
}
function warmed(options={},extraBook={}) {
  const made=make({initialPose:closed,...options},extraBook),snapshot=page();
  made.view.setPageSnapshot(snapshot,{pageTheme:0,redraw:false});
  made.view.draw(made.view.getPose());
  const model=gpu.renders.at(-1).model;
  gpu.renders.length=0; output(made.view).copies=[];
  return {...made,snapshot,model};
}
// The same fallback the bookshelf retains when the explicit commit is absent
// or cannot prove that the page is already painted.
function install(view,snapshot,options={pageTheme:0}) {
  const committed=view.commitPreparedPage?.(snapshot,options) === true;
  if(!committed)view.draw({...view.getPose(),...options});
  return committed;
}

describe('a prepared native page commits only an already current painted frame',()=>{
  it('retains a completed warm-up without a second render or GPU-to-2D copy',()=>{
    const {view,snapshot}=warmed();
    expect(install(view,snapshot)).toBe(true);
    expect(gpu.renders).toHaveLength(0);expect(output(view).copies).toHaveLength(0);
    expect(view.getPageTheme()).toBe(0);expect(view.canvas.dataset.pageTheme).toBe('0');
  });
  it('draws the white page when warm-up stopped before its final framebuffer',()=>{
    const {view}=make({initialPose:closed}),snapshot=page();
    view.setPageSnapshot(snapshot,{pageTheme:0,redraw:false});gpu.renders.length=0;
    expect(install(view,snapshot)).toBe(false);expect(gpu.renders).toHaveLength(1);
    expect(view.canvas.dataset.pageTheme).toBe('0');
  });
  it('keeps the original white-theme draw when the painted theme differs',()=>{
    const {view,snapshot}=warmed();view.setPageTheme(1);gpu.renders.length=0;
    expect(install(view,snapshot)).toBe(false);expect(gpu.renders).toHaveLength(1);
    expect(view.getPageTheme()).toBe(0);expect(view.canvas.dataset.pageTheme).toBe('0');
  });
  it('rejects a reinstalled snapshot even when its object identity is unchanged',()=>{
    const {view,snapshot}=warmed();
    view.setPageSnapshot(snapshot,{pageTheme:0,redraw:false});
    expect(install(view,snapshot)).toBe(false);expect(gpu.renders).toHaveLength(1);
  });
  it('draws a pose prepared without a framebuffer before opening',()=>{
    const {view,snapshot}=warmed();view.draw({...view.getPose(),angle:27,scale:.75},{redraw:false});
    expect(install(view,snapshot)).toBe(false);expect(gpu.renders).toHaveLength(1);
    expect(view.canvas.dataset.angle).toBe('27');expect(gpu.renders[0].frame.scale).toBe(.75);
  });
  it('preserves strict pose equality when a current coordinate changes by one ULP',()=>{
    const {view,snapshot}=warmed();
    view.draw({...view.getPose(),x:Number.EPSILON},{redraw:false});
    expect(install(view,snapshot)).toBe(false);expect(gpu.renders).toHaveLength(1);
    expect(view.getPose().x).toBe(Number.EPSILON);
  });
  it('restores its own native frame after another view acquires the renderer',()=>{
    const {view,snapshot}=warmed(),other=make({initialPose:closed}).view;
    other.draw(other.getPose());gpu.renders.length=0;
    expect(install(view,snapshot)).toBe(false);expect(gpu.renders).toHaveLength(1);
    expect(view.canvas.style.opacity).toBe('0');expect(other.canvas.style.opacity).toBe('');
  });
  it('reattaches a removed native node through the original draw',()=>{
    const {view,snapshot}=warmed();presentation().domElement.remove();
    expect(install(view,snapshot)).toBe(false);expect(gpu.renders).toHaveLength(1);
    expect(presentation().domElement.isConnected).toBe(true);
  });
  it('retains pixels while positioning the same native node under a moved or reparented host',()=>{
    const {view,snapshot,host}=warmed(),next=document.createElement('div');
    document.body.append(next);next.append(host);
    vi.spyOn(next,'getBoundingClientRect').mockReturnValue({left:10,top:15,width:500,height:900});
    view.canvas.getBoundingClientRect.mockReturnValue({left:30,top:40,width:390,height:844});
    expect(install(view,snapshot)).toBe(true);expect(gpu.renders).toHaveLength(0);
    expect(presentation().domElement.parentNode).toBe(next);
    expect(presentation().domElement.style.left).toBe('20px');expect(presentation().domElement.style.top).toBe('25px');
  });
  it('rejects a context lost and restored since the last actual draw',()=>{
    const {view,snapshot}=warmed();
    presentation().domElement.dispatchEvent(new Event('webglcontextlost'));
    presentation().domElement.dispatchEvent(new Event('webglcontextrestored'));
    expect(install(view,snapshot)).toBe(false);expect(gpu.renders).toHaveLength(1);
  });
  it('draws conservatively when the current context is unavailable or its getter throws',()=>{
    const {view,snapshot}=warmed();
    vi.spyOn(presentation(),'getContext').mockImplementation(()=>{throw new Error('Context unavailable');});
    expect(install(view,snapshot)).toBe(false);expect(gpu.renders).toHaveLength(1);
  });
  it('does not accept a native frame while an appearance replacement is pending',()=>{
    const {view,snapshot}=warmed({coverUrl:'blob:cold-real-cover'});
    view.updateAppearance({color:'#112244',shade:'#102030',ink:'#ffffff',coverRatio:.66,width:40});
    gpu.renders.length=0;
    expect(install(view,snapshot)).toBe(false);expect(gpu.renders).toHaveLength(1);
  });
  it('restores blocked material changes after cancelling an uncommitted insertion owner',()=>{
    const {view,snapshot}=warmed();let bridge;
    expect(view.handoffToShelfInsertion(next=>{bridge=next;return{cancel(){bridge.cancel();}};})).not.toBeNull();
    view.updateCoverAppearance({coverFinish:'matte'});
    view.updateSpineAppearance({title:'Updated spine'}, {color:'#293f61',shade:'#293344',ink:'#ffffff',coverRatio:.66,width:40});
    view.updateEdgeAppearance({pageEdgeFinish:'matte'});
    expect(gpu.renders).toHaveLength(0);bridge.cancel();
    expect(install(view,snapshot)).toBe(false);expect(gpu.renders).toHaveLength(1);
  });
  it('rejects an external presentation without changing its ownership',()=>{
    const {view,snapshot}=warmed();let bridge;
    expect(view.handoffToShelfInsertion(next=>{bridge=next;return{cancel(){bridge.cancel();}};})).not.toBeNull();
    expect(install(view,snapshot)).toBe(false);expect(gpu.renders).toHaveLength(0);
    bridge.cancel();
    // The attempted original draw dirtied the page; cancellation must restore it.
    expect(install(view,snapshot)).toBe(false);expect(gpu.renders).toHaveLength(1);
  });
  it('retains the original mutable legacy output behavior',()=>{
    const {view,snapshot}=warmed({directPresentation:false});
    const outputContext=output(view);outputContext.frame={consumer:'changed-pixels'};
    expect(install(view,snapshot)).toBe(false);expect(gpu.renders).toHaveLength(1);
    expect(outputContext.frame.consumer).toBeUndefined();expect(outputContext.copies).toHaveLength(1);
  });
  it('keeps export pixels lazy and restores consumer changes on the next actual capture',()=>{
    const {view,snapshot}=warmed();view.canvas.getContext('2d');output(view).copies=[];
    output(view).frame={consumer:'changed-pixels'};
    expect(install(view,snapshot)).toBe(true);expect(gpu.renders).toHaveLength(0);
    expect(output(view).copies).toHaveLength(0);view.canvas.getContext('2d');
    expect(output(view).copies).toHaveLength(1);expect(output(view).frame.consumer).toBeUndefined();
    expect(gpu.renders).toHaveLength(0);
  });
  it('does not apply the white-paper target when a snapshot has no stock variant',()=>{
    const {view}=make({initialPose:closed}),snapshot=page(false);
    view.setPageSnapshot(snapshot,{redraw:false});view.draw(view.getPose());gpu.renders.length=0;
    expect(install(view,snapshot,{})).toBe(true);expect(gpu.renders).toHaveLength(0);
    expect(view.getPageTheme()).toBe(1);
  });
  it('does not claim a disposed or deferred native frame is ready',()=>{
    const {view,snapshot}=warmed();view.deferDrawing();
    expect(install(view,snapshot)).toBe(false);expect(gpu.renders).toHaveLength(1);
    view.dispose();gpu.renders.length=0;
    expect(install(view,snapshot)).toBe(false);expect(gpu.renders).toHaveLength(0);
  });
});
