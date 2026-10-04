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


const record={id:'direct:0',title:'Actual Book',author:'Reader',format:'PDF'};
const appearance={color:'#42604b',shade:'#324c3a',ink:'#ffffff',coverRatio:.66,width:40};
function coverLoad(url,success=true) {
 const load=gpu.imageLoads.findLast(item=>item.url===url);expect(load).toBeTruthy();
 if(success){load.texture.image={width:900,height:600};load.onLoad(load.texture);}else load.onError();
}
function page(){const source=document.createElement('canvas');source.width=132;source.height=200;return {source,width:132,height:200,engine:'pdf',sourceType:'pdf-original',text:'Actual saved page',location:{locator:3},background:'#ffffff'};}

describe('actual parked model bookmark invalidation before the first return page',()=>{
  function park(){
    const {view,stage}=make(),opening=page();
    view.setPageSnapshot(opening,{redraw:false});view.draw(pose);
    const model=gpu.renders.at(-1).model;
    view.releaseToSnapshot({resume:true});stage.remove();
    const host=document.createElement('div');host.append(view.canvas);
    return {view,model,host,opening};
  }
  it('demonstrates the undeferred old-page GPU render and copy caused by a first-page locator',()=>{
    const {view,model,opening}=park(),renders=gpu.renders.length,readbacks=copies(view).length;
    expect(model.getObjectByName('reading-bookmark')).toBeUndefined();
    view.updateBookmark({...record,progressFraction:0,locator:{kind:'pdf-page',value:1}});
    expect(gpu.renders).toHaveLength(renders+1);
    expect(copies(view)).toHaveLength(readbacks+1);
    expect(gpu.renders.at(-1).model).toBe(model);
    expect(view.hasPageSnapshot(opening)).toBe(true);
    expect(model.getObjectByName('reading-bookmark')).toBeTruthy();
  });
  it('applies the actual final ribbon and new page before one aligned native frame',()=>{
    const {view,model,host}=park(),closing=page(),renders=gpu.renders.length,readbacks=copies(view).length;
    view.deferDrawing();view.updateBookmark({...record,progressFraction:0,locator:{kind:'pdf-page',value:1}});
    expect(model.getObjectByName('reading-bookmark')).toBeTruthy();
    expect(gpu.renders).toHaveLength(renders);expect(copies(view)).toHaveLength(readbacks);
    const stage=document.createElement('div');stage.append(host);document.body.append(stage);
    expect(view.setPageSnapshot(closing)).toBe(true);
    view.draw(pose,{redraw:false});
    expect(gpu.renders).toHaveLength(renders);expect(copies(view)).toHaveLength(readbacks);
    expect(view.alignToPage({left:8,top:48,width:132,height:200})).toBe(true);
    expect(gpu.renders).toHaveLength(renders+1);expect(copies(view)).toHaveLength(readbacks);
    expect(gpu.renders.at(-1).model).toBe(model);expect(view.hasPageSnapshot(closing)).toBe(true);
    expect(stage.querySelector('.ihr-book-live-canvas')).toBe(presentation().domElement);
  });
  it('preserves the compatible preparation that already defers actual model invalidations',async()=>{
    const {view,model}=park(),renders=gpu.renders.length,readbacks=copies(view).length;
    await expect(view.prepareReturnAppearance({...record,progressFraction:.73,locator:{kind:'pdf-page',value:7}},
      appearance,null)).resolves.toBe(true);
    expect(model.getObjectByName('reading-bookmark')).toBeTruthy();
    expect(gpu.renders).toHaveLength(renders);expect(copies(view)).toHaveLength(readbacks);
  });
});
