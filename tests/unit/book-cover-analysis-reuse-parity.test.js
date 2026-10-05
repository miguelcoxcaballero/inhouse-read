import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const gpu = vi.hoisted(() => ({ renderers:[], renders:[], imageLoads:[], groups:[], failPresentation:false }));
vi.mock('three', async importOriginal => {
  const THREE = await importOriginal();
  class Group extends THREE.Group { constructor() { super(); gpu.groups.push(this); } }
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
  return { ...THREE, Group, WebGLRenderer:Renderer, PMREMGenerator:PMREM, TextureLoader };
});

let contexts, views, bookView;
class Context {
  constructor(canvas) { this.canvas = canvas; this.font = '10px sans-serif'; this.frame = null; this.copies = []; this.texts = []; }
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
  fillRect() {} strokeRect() {} fillText(text) { (this.texts ||= []).push(String(text)); } strokeText() {} beginPath() {} closePath() {} rect() {} roundRect() {}
  moveTo() {} lineTo() {} quadraticCurveTo() {} bezierCurveTo() {} arc() {} ellipse() {}
  fill() {} stroke() {} save() {} restore() {} translate() {} scale() {} rotate() {} setTransform() {}
  clip() {} putImageData() {}
}

beforeEach(async () => {
  vi.resetModules(); contexts = new WeakMap(); views = [];
  gpu.groups.length = 0; gpu.renderers.length = 0; gpu.renders.length = 0; gpu.imageLoads.length = 0; gpu.failPresentation = false;
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
function make(options = {},record = {},initialStyle = nextStyle({})) {
  const stage = document.createElement('div'); stage.className = 'test-stage'; stage.style.position = 'relative';
  const host = document.createElement('div'); stage.append(host); document.body.append(stage);
  const view = bookView(host, { id:`direct:${views.length}`, title:'Actual Book', author:'Reader', format:'PDF',progressFraction:.42,...record },
    initialStyle,
    { width:132, height:200, thickness:40, viewportWidth:390, viewportHeight:844,
      centerX:195, centerY:350, initialPose:pose, deferDraw:true, ...options });
  expect(view).not.toBeNull(); views.push(view);
  vi.spyOn(view.canvas, 'getBoundingClientRect').mockReturnValue({ left:3, top:7, width:390, height:844, right:393, bottom:851 });
  return { view, host, stage };
}
const output = view => contexts.get(view.canvas);
const presentation = () => gpu.renderers.find(renderer => renderer.options.preserveDrawingBuffer);
const copies = view => output(view).copies.filter(copy => copy.source === presentation()?.domElement);

const creations = () => gpu.groups.filter(group => group.userData.detailLevel).length;
const liveModel = () => gpu.renders.at(-1).model;
const cover = model => model.getObjectByName('front-cover').material[0];
const nextStyle = extra => ({ color:'#42604b',shade:'#324c3a',ink:'#ffffff',coverRatio:.66,width:40,...extra });
function loadCover() {
  const load=gpu.imageLoads.at(-1);
  load.texture.image=Object.assign(document.createElement('canvas'),{width:400,height:600});
  load.onLoad(load.texture);
}
function resources(model) {
  const names=['front-cover','back-cover','page-block','binding-head-cap','binding-tail-cap',
    'reading-bookmark','reading-page','reading-page-paper','reading-page-stock'];
  return names.map(name => {
    const mesh=model.getObjectByName(name);
    return {name,mesh,geometry:mesh.geometry,material:mesh.material,map:mesh.material.map};
  });
}
function expectRetained(model,previous) {
  for(const old of previous) {
    const mesh=model.getObjectByName(old.name);
    expect(mesh,old.name).toBe(old.mesh);expect(mesh.geometry,old.name).toBe(old.geometry);
    expect(mesh.material,old.name).toBe(old.material);expect(mesh.material.map,old.name).toBe(old.map);
  }
}
function page(view) {
  const source=Object.assign(document.createElement('canvas'),{width:144,height:218});
  const paper=Object.assign(document.createElement('canvas'),{width:144,height:218});
  const snapshot={source,width:144,height:218,paper:{source:paper,width:144,height:218}};
  expect(view.setPageSnapshot(snapshot,{pageTheme:.3,redraw:false})).toBe(true);
  return snapshot;
}

const changes = [
  ['colour', {color:'#713b42',shade:'#51242c',ink:'#f4cf89'}],
  ['font', {fontFamily:'Georgia',fontCanvasFamily:'Georgia',fontFallback:'Georgia, serif',fontWeight:600,ink:'#d8bf73'}],
  ['ratio', {coverRatio:.75,color:'#713b42'}]
];
const cases = ['generated','decoded'].flatMap(kind => changes.map(([name,patch]) => [kind,name,patch]));
function textureState(texture) {
  if (!texture) return null;
  const image=texture.image;
  return {width:image?.width,height:image?.height,data:image?.data?Array.from(image.data):null,
    texts:image&&contexts.get(image)?contexts.get(image).texts.slice():null,
    font:image&&contexts.get(image)?contexts.get(image).font:null,
    colorSpace:texture.colorSpace,magFilter:texture.magFilter,minFilter:texture.minFilter,
    generateMipmaps:texture.generateMipmaps,wrapS:texture.wrapS,wrapT:texture.wrapT,
    anisotropy:texture.anisotropy,repeat:texture.repeat.toArray()};
}
function materialState(material) {
  return [].concat(material).map(m => ({
    color:m.color?.getHexString(),roughness:m.roughness,metalness:m.metalness,
    clearcoat:m.clearcoat,clearcoatRoughness:m.clearcoatRoughness,normalScale:m.normalScale?.toArray(),
    opacity:m.opacity,side:m.side,transparent:m.transparent,toneMapped:m.toneMapped,
    maps:['map','normalMap','roughnessMap','metalnessMap','bumpMap','alphaMap'].map(key=>[key,textureState(m[key])])
  }));
}
function appearanceState(model) {
  return ['front-cover','back-cover','binding','binding-head-cap','binding-tail-cap',
    'reading-bookmark','reading-page','reading-page-paper','reading-page-stock','read-leaves'].map(name=>{
    const object=model.getObjectByName(name);expect(object,name).toBeTruthy();
    return {name,visible:object.visible,position:object.position.toArray(),rotation:object.rotation.toArray(),
      geometry:{position:Array.from(object.geometry.attributes.position.array),normal:Array.from(object.geometry.attributes.normal.array),
        uv:Array.from(object.geometry.attributes.uv.array),index:object.geometry.index?Array.from(object.geometry.index.array):null},
      materials:materialState(object.material)};
  });
}
describe('cover-analysis opt-in existing material parity',()=>{
  it.each(cases)('matches a fresh %s case after a %s style change without replacing its displayed model',async(kind,_name,patch)=>{
    const record={id:'appearance-parity',title:'Appearance Material Parity',author:'Reader',format:'PDF',progressFraction:.42,
      spineFinish:'gold',spineTextFinish:'gold',spineEngraved:true,coverFinish:'satin',pageEdgeFinish:'glossy'};
    const options=kind==='decoded'?{coverUrl:'blob:appearance-parity'}:{};
    const {view}=make(options,record);if(kind==='decoded')loadCover();await view.ready;
    const snapshot=page(view),painted={...pose,angle:31,pitch:9,coverOpen:.6,bookmarkWithdraw:.3,pageTheme:.3};view.draw(painted);
    const retained=liveModel(),pageMeshes=['reading-page','reading-page-stock','reading-page-paper','reading-bookmark','read-leaves'].map(name=>retained.getObjectByName(name));
    const identities=pageMeshes.map(mesh=>({mesh,geometry:mesh.geometry,material:mesh.material,map:mesh.material.map}));
    const before=creations(),next=nextStyle(patch);
    expect(view.updateAppearance(next,{reuseModel:true})).toBe(true);await view.ready;
    expect(creations()-before).toBe(0);expect(liveModel()).toBe(retained);expect(view.getPose()).toEqual(painted);
    expect(view.hasPageSnapshot(snapshot)).toBe(true);
    for(const prior of identities){expect(prior.mesh.geometry).toBe(prior.geometry);expect(prior.mesh.material).toBe(prior.material);expect(prior.mesh.material.map).toBe(prior.map);}
    const reusedState=appearanceState(retained);
    const fresh=make(options,record,next).view;await fresh.ready;
    expect(fresh.setPageSnapshot(snapshot,{pageTheme:.3,redraw:false})).toBe(true);fresh.draw(painted);
    expect(appearanceState(liveModel())).toEqual(reusedState);
    expect(fresh.getPose()).toEqual(view.getPose());expect(fresh.hasPageSnapshot(snapshot)).toBe(true);
    // This CPU driver compares actual geometry/material properties and synthetic
    // painter records. Real antialiasing, raster and PNG equality remain GPU work.
  });
});
