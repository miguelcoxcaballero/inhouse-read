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

describe('real retained bookView appearance preparation',()=>{
 it('updates real ribbon and read-leaf geometry from .21 to .73 before HD return without drawing',async()=>{
  const oldBook={...record,progressFraction:.21},finalBook={...record,progressFraction:.73};
  const returnPose={...pose,coverOpen:.55,bookmarkWithdraw:.2,pageTheme:.7};
  const {view}=make({initialPose:returnPose},oldBook),snapshot=page();
  view.setPageSnapshot(snapshot,{pageTheme:.7,redraw:false});view.draw(returnPose);
  const retained=gpu.renders.at(-1).model;
  function shape(mesh){
   expect(mesh?.isMesh).toBe(true);expect(mesh.geometry.attributes.position.count).toBeGreaterThan(0);
   return {attributes:Object.fromEntries(Object.entries(mesh.geometry.attributes).sort(([a],[b])=>a.localeCompare(b))
    .map(([key,value])=>[key,{itemSize:value.itemSize,normalized:value.normalized,array:Array.from(value.array)}])),
    index:mesh.geometry.index ? Array.from(mesh.geometry.index.array) : null};
  }
  function materials(mesh){return (Array.isArray(mesh.material)?mesh.material:[mesh.material]).map(material=>({
   type:material.type,color:material.color?.toArray(),roughness:material.roughness,metalness:material.metalness,
   sheen:material.sheen,sheenColor:material.sheenColor?.toArray(),sheenRoughness:material.sheenRoughness,
   anisotropy:material.anisotropy,specularIntensity:material.specularIntensity,alphaTest:material.alphaTest,
   side:material.side,toneMapped:material.toneMapped,vertexColors:material.vertexColors,
   map:material.map ? {colorSpace:material.map.colorSpace,repeat:material.map.repeat.toArray(),wrapS:material.map.wrapS,wrapT:material.map.wrapT} : null,
   alphaMap:Boolean(material.alphaMap)}));}
  const initialRibbon=shape(retained.getObjectByName('reading-bookmark')),initialLeaves=shape(retained.getObjectByName('read-leaves'));
  const renders=gpu.renders.length,pending=view.prepareReturnAppearance(finalBook,appearance,'blob:new-HD-progress');
  expect(gpu.renders).toHaveLength(renders);coverLoad('blob:new-HD-progress');await expect(pending).resolves.toBe(true);
  expect(gpu.renders).toHaveLength(renders);expect(view.hasPageSnapshot(snapshot)).toBe(true);
  const fresh=make({coverUrl:'blob:new-HD-progress',initialPose:returnPose},finalBook).view;
  await fresh.ready;fresh.setPageSnapshot(snapshot,{pageTheme:.7,redraw:false});fresh.draw(returnPose);
  const expected=gpu.renders.at(-1).model;
  expect(expected).not.toBe(retained);expect(expected.userData.coverLoaded).toBe(true);
  expect(oldBook.progressFraction).toBe(.21);expect(finalBook.progressFraction).toBe(.73);
  expect(shape(expected.getObjectByName('reading-bookmark'))).not.toEqual(initialRibbon);
  expect(shape(expected.getObjectByName('read-leaves'))).not.toEqual(initialLeaves);
  for(const name of ['reading-bookmark','read-leaves']){
   expect.soft(shape(retained.getObjectByName(name)),`${name} uses the latest .73 progress`).toEqual(shape(expected.getObjectByName(name)));
   expect.soft(materials(retained.getObjectByName(name)),`${name} retains exact fresh-model materials`).toEqual(materials(expected.getObjectByName(name)));
   expect(retained.getObjectByName(name).visible).toBe(expected.getObjectByName(name).visible);
  }
  view.draw(returnPose);expect(gpu.renders.at(-1).model).toBe(retained);
 });
 it('preserves the same model, page textures, ribbon and vertices while upgrading a decoded HD cover',async()=>{
  const {view}=make();view.updateBookmark({...record,progressFraction:.5});view.draw(pose);const before=gpu.renders.at(-1).model,snapshot=page();view.setPageSnapshot(snapshot);
  const paper=before.userData.pageSurface,leafGeometry=paper.geometry,pageMap=paper.material.map,ribbon=before.getObjectByName('reading-bookmark');
  expect(ribbon).toBeTruthy();
  const vertices=before.children.filter(child=>child.isMesh).map(child=>child.geometry);const renders=gpu.renders.length;
  const pending=view.prepareReturnAppearance({...record,progressFraction:.5},appearance,'blob:HD');
  expect(gpu.renders).toHaveLength(renders);coverLoad('blob:HD');await expect(pending).resolves.toBe(true);
  expect(gpu.renders).toHaveLength(renders);expect(view.hasPageSnapshot(snapshot)).toBe(true);
  expect(before.userData.pageSurface).toBe(paper);expect(paper.geometry).toBe(leafGeometry);expect(paper.material.map).toBe(pageMap);
  expect(before.getObjectByName('reading-bookmark')).toBe(ribbon);expect(before.children.filter(child=>child.isMesh).map(child=>child.geometry)).toEqual(vertices);
  view.draw(pose);expect(gpu.renders.at(-1).model).toBe(before);expect(gpu.renders.at(-1).model.userData.coverLoaded).toBe(true);
 });
 it('updates supported automatic colors and font in the same physical model before its first new draw',async()=>{
  const {view}=make();view.draw(pose);const model=gpu.renders.at(-1).model,renders=gpu.renders.length;
  const next={...appearance,color:'#19394f',ink:'#ececec',fontFamily:'DM Sans'};
  await expect(view.prepareReturnAppearance(record,next,undefined)).resolves.toBe(true);
  expect(gpu.renders).toHaveLength(renders);view.draw(pose);expect(gpu.renders.at(-1).model).toBe(model);
  expect(model.userData.coverLoaded).toBe(true);expect(view.getPose()).toMatchObject(pose);
 });
 it('refuses pending or failed cover models before incremental mutation',async()=>{
  const {view}=make({coverUrl:'blob:cold'});
  await expect(view.prepareReturnAppearance(record,appearance,'blob:HD')).resolves.toBe(false);
  expect(gpu.imageLoads.filter(load=>load.url==='blob:HD')).toHaveLength(0);coverLoad('blob:cold',false);
  await expect(view.prepareReturnAppearance(record,appearance,'blob:HD')).resolves.toBe(false);
 });
 it('waits for the updated cover relief before declaring reuse ready without repainting',async()=>{
  const relief={id:'red-zone',color:'#ff0000',strength:.5,finish:'glossy'};
  const {view}=make({}, {coverRelief:relief});view.draw(pose);const model=gpu.renders.at(-1).model;
  let finish;const ready=new Promise(resolve=>finish=resolve);vi.spyOn(model.userData,'setCoverRelief').mockReturnValue(ready);
  const renders=gpu.renders.length,pending=view.prepareReturnAppearance({...record,coverRelief:relief},appearance,'blob:relief-HD');
  let settled=false;pending.then(()=>settled=true);coverLoad('blob:relief-HD');await Promise.resolve();await Promise.resolve();
  expect(model.userData.setCoverRelief).toHaveBeenCalledWith(relief);expect(settled).toBe(false);
  expect(gpu.renders).toHaveLength(renders);finish(true);await expect(pending).resolves.toBe(true);
 });
 it('returns false on failed HD decoding while retaining the previous unpresented frame for disposal',async()=>{
  const {view}=make();view.draw(pose);const model=gpu.renders.at(-1).model,renders=gpu.renders.length;
  const pending=view.prepareReturnAppearance(record,appearance,'blob:failed-HD');coverLoad('blob:failed-HD',false);
  await expect(pending).resolves.toBe(false);expect(gpu.renders).toHaveLength(renders);expect(gpu.renders.at(-1).model).toBe(model);
 });
 it('rejects edited finishes, changed ratio and unsupported style before loading a new source',async()=>{
  const {view}=make();
  await expect(view.prepareReturnAppearance({...record,coverFinish:'glossy'},appearance,'blob:HD')).resolves.toBe(false);
  await expect(view.prepareReturnAppearance(record,{...appearance,coverRatio:.7},'blob:HD')).resolves.toBe(false);
  await expect(view.prepareReturnAppearance(record,{...appearance,unsupported:true},'blob:HD')).resolves.toBe(false);
  expect(gpu.imageLoads).toHaveLength(0);
 });
 it('keeps disposed and superseded preparation from reporting reuse success',async()=>{
  const {view}=make();const pending=view.prepareReturnAppearance(record,appearance,'blob:HD');view.dispose();coverLoad('blob:HD');
  await expect(pending).resolves.toBe(false);
  const other=make().view;const upgrade=other.prepareReturnAppearance({...record,id:'direct:1'},appearance,'blob:second-HD');
  other.updateAppearance({...appearance,color:'#123456'});coverLoad('blob:second-HD');
  await expect(upgrade).resolves.toBe(false);
 });
});
