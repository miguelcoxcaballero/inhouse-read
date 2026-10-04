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
  constructor(canvas) { this.canvas = canvas; this.frame = null; this.copies = []; this.texts = []; }
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
  console.info('EDITOR_MODEL_COUNT '+JSON.stringify({case:expect.getState().currentTestName,wholeModels:gpu.groups.filter(group => group.userData.detailLevel).length,control:process.env.EDITOR_ORIGINAL_SOURCE === '1'}));
  for (const view of views) view.dispose();
  document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

const pose = { x:0, y:0, scale:1, angle:0, pitch:0, roll:0, coverOpen:1, bookmarkWithdraw:1, pageTheme:1 };
function make(options = {},record = {}) {
  const stage = document.createElement('div'); stage.className = 'test-stage'; stage.style.position = 'relative';
  const host = document.createElement('div'); stage.append(host); document.body.append(stage);
  const view = bookView(host, { id:`direct:${views.length}`, title:'Actual Book', author:'Reader', format:'PDF',progressFraction:.42,...record },
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
describe('editor commit with retained actual book resources',() => {
  it('adds zero models after font/material previews and preserves page, cap, ribbon, pose and decoded jacket identities',() => {
    const {view}=make({coverUrl:'blob:editor-decoded'});loadCover();
    const snapshot=page(view);view.draw({...pose,angle:52,pitch:9,coverOpen:.6,bookmarkWithdraw:.3,pageTheme:.3});
    const original=liveModel(),before=resources(original),map=cover(original).map;
    const beforeCreations=creations(),beforePose=view.getPose(),textures=view.pageTextures();
    const style=nextStyle({fontFamily:'Georgia',fontCanvasFamily:'Georgia',spineFontSize:18});
    view.updateSpineAppearance({spineFontSize:18,spineSurfaceFinish:'glossy'},style);
    view.updateCoverAppearance({coverFinish:'glossy'});view.updateEdgeAppearance({pageEdgeFinish:'glossy'});
    const renders=gpu.renders.length;
    expect(view.updateAppearance(style,{reuseModel:true})).toBe(true);
    expect(creations()-beforeCreations).toBe(0);expect(liveModel()).toBe(original);
    expectRetained(original,before);expect(cover(original).map).toBe(map);
    expect(view.hasPageSnapshot(snapshot)).toBe(true);expect(view.pageTextures()).toEqual(textures);
    expect(view.getPose()).toEqual(beforePose);expect(gpu.renders.length-renders).toBe(1);
    expect(gpu.imageLoads).toHaveLength(1);
    expect(original.getObjectByName('binding-head-cap').material.color.getHexString()).toBe('42604b');
    expect(original.getObjectByName('reading-bookmark').visible).toBe(true);
  });
  it('repaints a decoded jacket when color and physical raster ratio change without recreating geometry or changing resolution',() => {
    const {view}=make({coverUrl:'blob:editor-color'});loadCover();view.draw(pose);
    const original=liveModel(),before=resources(original),material=cover(original),map=material.map;
    const release=vi.spyOn(map,'dispose'),oldHeight=map.image.height,count=creations();
    const renders=gpu.renders.length;
    view.updateAppearance(nextStyle({color:'#713b42',coverRatio:.75}),{reuseModel:true});
    expect(creations()-count).toBe(0);expect(liveModel()).toBe(original);expectRetained(original,before);
    expect(cover(original)).toBe(material);expect(material.map).not.toBe(map);expect(release).toHaveBeenCalledOnce();
    expect(material.map.image.height).toBe(oldHeight);expect(material.map.image.width).toBe(Math.round(oldHeight*.75));
    expect(original.getObjectByName('binding-head-cap').material.color.getHexString()).toBe('713b42');
    expect(gpu.imageLoads).toHaveLength(1);expect(gpu.renders.length-renders).toBe(1);
  });
  it('repaints the generated title, author and font while keeping the same page, bookmark and board resources',() => {
    const {view}=make();const snapshot=page(view);view.draw({...pose,angle:31,coverOpen:.4,bookmarkWithdraw:.2});
    const original=liveModel(),before=resources(original),map=cover(original).map,count=creations(),oldHeight=map.image.height;
    view.updateCoverAppearance({title:'Nuevo titulo generado',author:'Nueva autora'});
    const renders=gpu.renders.length;
    view.updateAppearance(nextStyle({color:'#713b42',fontFamily:'Georgia',fontCanvasFamily:'Georgia'}),{reuseModel:true});
    expect(creations()-count).toBe(0);expect(liveModel()).toBe(original);expectRetained(original,before);
    expect(cover(original).map).not.toBe(map);expect(cover(original).map.image.height).toBe(oldHeight);
    expect(contexts.get(cover(original).map.image).texts.join(' ')).toContain('Nuevo titulo generado');
    expect(contexts.get(cover(original).map.image).texts).toContain('Nueva autora');
    expect(view.hasPageSnapshot(snapshot)).toBe(true);expect(view.getPose()).toMatchObject({angle:31,coverOpen:.4,bookmarkWithdraw:.2});
    expect(gpu.renders.length-renders).toBe(1);
  });
  it('keeps the original full replacement while a real cover is still loading, retaining deferred first-paint semantics',async () => {
    const {view}=make({coverUrl:'blob:editor-loading'});const originalReady=view.ready,count=creations();
    view.draw({...pose,angle:44},{redraw:false});
    view.updateAppearance(nextStyle({color:'#713b42'}),{reuseModel:true});
    expect(creations()-count).toBe(1);expect(gpu.renders).toHaveLength(0);
    loadCover();await Promise.all([originalReady,view.ready]);await Promise.resolve();
    expect(gpu.renders).toHaveLength(0);expect(view.getPose().angle).toBe(44);
    view.draw(view.getPose());expect(gpu.renders).toHaveLength(1);
  });
  it('keeps the original full retry/replacement when the real cover failed',() => {
    const {view}=make({coverUrl:'blob:editor-failed'});gpu.imageLoads.at(-1).onError();view.draw(pose);
    const original=liveModel(),count=creations();
    view.updateAppearance(nextStyle({color:'#713b42'}),{reuseModel:true});
    expect(creations()-count).toBe(1);expect(liveModel()).toBe(original);
    expect(gpu.imageLoads).toHaveLength(2);
  });
  it('retains displayed pixels during deferred generated-case work and applies the new pose only on the next explicit draw',() => {
    const {view}=make();view.draw({...pose,angle:17});const original=liveModel(),displayed=structuredClone(presentation().domElement.frame),count=creations();
    view.deferDrawing();view.draw({...pose,angle:73},{redraw:false});
    const renders=gpu.renders.length;
    view.updateAppearance(nextStyle({color:'#713b42'}),{reuseModel:true});
    expect(creations()-count).toBe(0);expect(gpu.renders.length).toBe(renders);
    expect(JSON.parse(view.canvas.toDataURL())).toEqual(displayed);
    view.draw(view.getPose());expect(liveModel()).toBe(original);expect(view.getPose().angle).toBe(73);
  });
});
