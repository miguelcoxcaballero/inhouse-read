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

function external(view, stage, { failPosition=false } = {}) {
  expect(typeof view.handoffToShelfInsertion).toBe('function');
  const shared=gpu.renderers[0], frame={book:'retained-book-only',progress:.4}, combined={room:'retained-room',book:frame};
  let bridge, lease, captured=0, cleaned=0;
  const handle={finished:new Promise(()=>{}),cancel() { bridge.cancel(); }};
  expect(view.handoffToShelfInsertion(value => {
    bridge=value;
    lease=bridge.createLease({
      capture(context) {
        try { shared.domElement.frame=structuredClone(frame); context.clearRect(); context.drawImage(shared.domElement,0,0); captured++; }
        finally { if(lease.isOwner()) shared.domElement.frame=structuredClone(combined); }
      },
      repaint() { shared.domElement.frame=structuredClone(combined); },
      position(node) { stage.append(node);node.className='native-insertion';if(failPosition)throw new Error('first presentation failed');return true; },
      cleanup() { cleaned++; }
    });
    return handle;
  })).toBe(handle);
  return {bridge,lease,shared,frame,combined,get captured(){return captured;},get cleaned(){return cleaned;},
    paint() { shared.domElement.frame=structuredClone(combined);lease.markDirty();expect(lease.present()).toBe(true);expect(bridge.commit(lease)).toBe(true); }
  };
}

describe('transactional native shelf insertion handoff',()=>{
  it('keeps the exact closed flyout until first insertion paint and freezes asynchronous old-model draws',()=>{
    const {view,stage}=make();view.draw({...pose,coverOpen:0,angle:90});
    const closed=structuredClone(presentation().domElement.frame),renders=gpu.renders.length;
    const insertion=external(view,stage);
    expect(presentation().domElement.parentElement).toBe(stage);
    expect(copies(view)).toHaveLength(0);expect(output(view).frame).toBeNull();
    view.draw({...pose,angle:1});view.updateSpineAppearance({title:'Late'}, {color:'#103d4b',ink:'#eee'});
    expect(gpu.renders).toHaveLength(renders);expect(presentation().domElement.frame).toEqual(closed);
    insertion.paint();
    expect(presentation().domElement.parentElement).toBeNull();expect(insertion.shared.domElement.parentElement).toBe(stage);
    expect(insertion.shared.domElement.frame).toEqual(insertion.combined);
    expect(copies(view)).toHaveLength(0);expect(insertion.captured).toBe(0);expect(view.canvas.style.opacity).toBe('0');
  });

  it('exports retained book-only pixels and restores the settled combined presentation after every actual export',async()=>{
    const {view,stage}=make();view.draw({...pose,coverOpen:0,angle:90});
    const insertion=external(view,stage);insertion.paint();
    const retained=view.canvas.getContext('2d');
    expect(retained.frame).toEqual(insertion.frame);expect(insertion.captured).toBe(1);
    expect(insertion.shared.domElement.frame).toEqual(insertion.combined);
    insertion.frame.progress=.8;insertion.lease.markDirty();
    expect(retained.getImageData(0,0,1,1).frame).toEqual(insertion.frame);
    expect(insertion.shared.domElement.frame).toEqual(insertion.combined);
    expect(insertion.captured).toBe(2);
    insertion.frame.progress=.9;insertion.lease.markDirty();
    const observer=document.createElement('canvas').getContext('2d');observer.drawImage(view.canvas,0,0);
    expect(observer.frame).toEqual(insertion.frame);expect(insertion.captured).toBe(3);
    expect(insertion.shared.domElement.frame).toEqual(insertion.combined);
    insertion.frame.progress=1;insertion.lease.markDirty();
    const blob=await new Promise(resolve=>view.canvas.toBlob(resolve));
    expect(JSON.parse(new TextDecoder().decode(await blob.arrayBuffer()))).toEqual(insertion.frame);
    expect(JSON.parse(view.canvas.toDataURL())).toEqual(insertion.frame);expect(insertion.captured).toBe(4);
    expect(insertion.shared.domElement.frame).toEqual(insertion.combined);
    expect(copies(view)).toHaveLength(0);
  });

  it('transfers native ownership to room and keeps late book exports and old disposal from replacing or detaching room',()=>{
    const {view,stage}=make();view.draw({...pose,coverOpen:0});const insertion=external(view,stage);insertion.paint();
    const roomHost=document.createElement('div');document.body.append(roomHost);
    const roomCanvas=document.createElement('canvas'),context=roomCanvas.getContext('2d'),roomFrame={room:'final-room'};
    const room=broker.createNativeRendererPresentation(insertion.shared,{canvas:roomCanvas,context,
      capture(ctx){ctx.drawImage(insertion.shared.domElement,0,0);},repaint(){insertion.shared.domElement.frame=structuredClone(roomFrame);},
      position(node){roomHost.append(node);return true;}});
    broker.withRendererPresentation(insertion.shared,room,()=>{
      insertion.shared.domElement.frame=structuredClone(roomFrame);expect(insertion.lease.transferTo(room)).toBe(true);
    });
    insertion.lease.markDirty();
    expect(JSON.parse(view.canvas.toDataURL())).toEqual(insertion.frame);
    expect(insertion.shared.domElement.frame).toEqual(roomFrame);expect(room.isOwner()).toBe(true);
    view.dispose();expect(insertion.shared.domElement.parentElement).toBe(roomHost);expect(room.isOwner()).toBe(true);
    expect(insertion.cleaned).toBe(1);view.dispose();expect(insertion.cleaned).toBe(1);
    room.dispose();
  });

  it('rolls back failed position ownership, DOM and previous GPU output after a foreign paint transaction',()=>{
    const {view,stage}=make();view.draw({...pose,coverOpen:0});const insertion=external(view,stage,{failPosition:true});
    const roomHost=document.createElement('div');document.body.append(roomHost);
    const roomCanvas=document.createElement('canvas'),context=roomCanvas.getContext('2d'),roomFrame={room:'before-failed-position'};
    const room=broker.createNativeRendererPresentation(insertion.shared,{canvas:roomCanvas,context,capture(){},
      repaint(){insertion.shared.domElement.frame=structuredClone(roomFrame);},position(node){node.className='native-room';roomHost.append(node);return true;}});
    expect(room.present()).toBe(true);insertion.shared.domElement.frame=structuredClone(roomFrame);
    broker.withRendererPresentation(insertion.shared,insertion.lease,()=>{
      insertion.shared.domElement.frame={book:'failed-foreign-paint'};expect(room.transferTo(insertion.lease)).toBe(false);
    });
    expect(insertion.shared.domElement.frame).toEqual(roomFrame);expect(room.isOwner()).toBe(true);
    expect(insertion.shared.domElement.parentElement).toBe(roomHost);expect(insertion.shared.domElement.className).toBe('native-room');
    expect(presentation().domElement.parentElement).toBe(stage);expect(copies(view)).toHaveLength(0);
    insertion.bridge.cancel();room.dispose();
  });

  it('resumes the original book renderer when a first insertion request is unsupported or cancelled',()=>{
    const {view,stage}=make();view.draw({...pose,coverOpen:0,angle:90});expect(typeof view.handoffToShelfInsertion).toBe('function');
    expect(view.handoffToShelfInsertion(()=>null)).toBeNull();expect(copies(view)).toHaveLength(0);
    expect(view.canvas.style.opacity).toBe('0');
    view.draw({...pose,angle:43});expect(presentation().domElement.frame.angle).toBeCloseTo(43);
    const displayed=structuredClone(presentation().domElement.frame);
    output(view).frame={page:'stale open page from reader handoff'};
    const insertion=external(view,stage);insertion.bridge.cancel();
    expect(view.canvas.style.opacity).toBe('0');
    expect(presentation().domElement.frame).toEqual(displayed);expect(presentation().domElement.parentElement).toBe(stage);
    view.draw({...pose,angle:57});expect(presentation().domElement.frame.angle).toBeCloseTo(57);
    expect(JSON.parse(view.canvas.toDataURL()).angle).toBeCloseTo(57);expect(insertion.cleaned).toBe(1);
  });

  it('rejects a stale flyout owner, non-native view and disposed view before invoking an insertion',()=>{
    const {view}=make();view.draw({...pose,coverOpen:0});expect(typeof view.handoffToShelfInsertion).toBe('function');
    const second=make().view;second.draw(pose);const start=vi.fn();
    expect(view.handoffToShelfInsertion(start)).toBeNull();expect(start).not.toHaveBeenCalled();
    const fallback=make({directPresentation:false}).view;
    expect(fallback.handoffToShelfInsertion(start)).toBeNull();fallback.dispose();
    expect(fallback.handoffToShelfInsertion(start)).toBeNull();expect(start).not.toHaveBeenCalled();
  });

  it('rejects a disposed pending bridge and releases only its own insertion resources',()=>{
    const {view,stage}=make();view.draw({...pose,coverOpen:0});const insertion=external(view,stage);
    view.dispose();expect(insertion.bridge.commit(insertion.lease)).toBe(false);expect(insertion.lease.present()).toBe(false);
    expect(insertion.cleaned).toBe(1);expect(insertion.shared.domElement.parentElement).toBeNull();
  });

  it('restores the closed pose of an asynchronous prepared replacement after active cancellation without stealing a newer flyout',()=>{
    const {view,stage}=make();const closed={...pose,coverOpen:0,angle:77,x:14,y:-8,scale:.7};view.draw(closed);
    const insertion=external(view,stage);insertion.paint();
    view.updateAppearance({color:'#293f61',ink:'#ffffff',coverRatio:.66});
    insertion.bridge.cancel();expect(presentation().domElement.frame.angle).toBeCloseTo(77);
    expect(presentation().domElement.frame.scale).toBeCloseTo(.7);
    const again=external(view,stage);again.paint();const newer=make().view;newer.draw({...pose,angle:35});
    const displayed=structuredClone(presentation().domElement.frame);again.bridge.cancel();
    expect(presentation().domElement.frame).toEqual(displayed);
    expect(presentation().domElement.parentElement).toBe(newer.canvas.parentElement.parentElement);
  });

  it('copies a legacy shared book frame before restoring the native room owner',()=>{
    const {view}=make();view.draw(pose);const shared=gpu.renderers[0];
    const roomHost=document.createElement('div');document.body.append(roomHost);
    const roomCanvas=document.createElement('canvas'),context=roomCanvas.getContext('2d'),roomFrame={room:'held-room'};
    const room=broker.createNativeRendererPresentation(shared,{canvas:roomCanvas,context,capture(){},
      repaint(){shared.domElement.frame=structuredClone(roomFrame);},position(node){roomHost.append(node);return true;}});
    expect(room.present()).toBe(true);shared.domElement.frame=structuredClone(roomFrame);
    const foreign=make({shelf:true,directPresentation:false}).view;foreign.draw({...pose,angle:76});
    expect(output(foreign).frame.angle).toBeCloseTo(76);expect(output(foreign).frame.room).toBeUndefined();
    expect(shared.domElement.frame).toEqual(roomFrame);expect(shared.domElement.parentElement).toBe(roomHost);
    room.dispose();
  });
});
