import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildReliefMaps } from '../../src/js/cover-relief.js';

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

vi.mock('../../src/js/cover-relief.js',async original=>({...await original(),buildReliefMaps:vi.fn()}));
vi.mock('../../src/js/cover-appearance.js',async original=>({...await original(),runInSlices:vi.fn(task=>{
  let step;do { step=task.next(); } while(!step.done);return Promise.resolve(step.value);
})}));
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
  vi.mocked(buildReliefMaps).mockReset().mockImplementation(async()=>maps());
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

const maps = () => ({ size:{width:2,height:2},
  normal:new Uint8ClampedArray([128,128,255,255,128,128,255,255,128,128,255,255,128,128,255,255]),
  pixels:{width:2,height:2,preserveInk:true,mask:new Uint8Array([0,255,255,0]),
    foil:new Uint8Array(4),gloss:new Uint8Array([0,255,255,0])} });
const relief = {id:'color-1',color:'#d4a93c',tolerance:4,strength:.75};
const allModels = () => gpu.groups.filter(group => group.userData.detailLevel);
const edge = model => model.getObjectByName('page-block').material[0];
const mutateSpies = model => ({
  cover:vi.spyOn(model.userData,'updateCoverAppearance'),
  edge:vi.spyOn(model.userData,'updateEdgeAppearance')
});

describe('one synchronous editor material paint with actual book models',() => {
  it('applies both visible material changes in one render without changing pose, page or native output',() => {
    const {view,stage}=make();const snapshot=page(view);view.draw({...pose,angle:39,coverOpen:.6,pageTheme:.3});
    const model=liveModel(),before=resources(model),native=presentation().domElement,previous=view.getPose();
    const count=gpu.renders.length,created=creations(),spies=mutateSpies(model);
    const next={coverFinish:'glossy',pageEdgeFinish:'matte',author:'Latest author'};
    expect(view.updateEditorAppearance(next)).toBe(true);
    expect(spies.cover).toHaveBeenCalledExactlyOnceWith(next);expect(spies.edge).toHaveBeenCalledExactlyOnceWith(next);
    expect(gpu.renders.length-count).toBe(1);expect(creations()).toBe(created);
    expect(liveModel()).toBe(model);expectRetained(model,before);expect(view.getPose()).toEqual(previous);
    expect(view.hasPageSnapshot(snapshot)).toBe(true);expect(presentation().domElement).toBe(native);
    expect(native.parentElement).toBe(stage);expect(copies(view)).toHaveLength(0);
    expect(cover(model).roughness).toBe(.18);expect(edge(model).roughness).toBeCloseTo(.35+.94*.6);
  });
  it('conservatively paints once for a spine-only full record and merges its title and author before final commit',() => {
    const {view}=make();view.draw({...pose,angle:31});
    const model=liveModel(),count=gpu.renders.length;
    const next={title:'Merged generated title',author:'Merged author',spineFontSize:22};
    expect(view.updateEditorAppearance(next)).toBe(true);expect(gpu.renders.length-count).toBe(1);
    view.updateAppearance(nextStyle({fontFamily:'Georgia',fontCanvasFamily:'Georgia'}),{reuseModel:true});
    expect(contexts.get(cover(model).map.image).texts.join(' ')).toContain('Merged generated title');
    expect(contexts.get(cover(model).map.image).texts).toContain('Merged author');
  });
  it('updates pending and displayed real models synchronously while a decoded jacket is still loading',() => {
    const {view}=make({coverUrl:'blob:batch-pending'});view.draw(pose);
    const visible=liveModel();view.updateAppearance(nextStyle({color:'#713b42'}),{reuseModel:true});
    const pending=allModels().at(-1);expect(pending).not.toBe(visible);
    const a=mutateSpies(visible),b=mutateSpies(pending),count=gpu.renders.length,created=creations();
    const next={coverFinish:'glossy',pageEdgeFinish:'matte',title:'Latest pending title'};
    expect(view.updateEditorAppearance(next)).toBe(true);
    for(const spies of [a,b]) {expect(spies.cover).toHaveBeenCalledExactlyOnceWith(next);expect(spies.edge).toHaveBeenCalledExactlyOnceWith(next);}
    expect(gpu.renders.length-count).toBe(1);expect(creations()).toBe(created);
    expect(cover(visible).roughness).toBe(.18);expect(cover(pending).roughness).toBe(.18);
  });
  it('keeps default redraws for absent, null and previously ignored extra options',() => {
    const {view}=make();view.draw(pose);const before=gpu.renders.length;
    for(const options of [undefined,null,{},false,{redraw:true},{redraw:null}]) {
      expect(view.updateCoverAppearance({coverFinish:'satin'},options)).toBe(true);
      expect(view.updateEdgeAppearance({pageEdgeFinish:'satin'},options)).toBe(true);
    }
    expect(gpu.renders.length-before).toBe(12);
  });
  it('uses only an explicit redraw false to mute the synchronous draw while retaining record merges',() => {
    const {view}=make();view.draw(pose);const model=liveModel(),count=gpu.renders.length;
    const invalidate=model.userData.invalidate;
    view.updateCoverAppearance({title:'Silent generated title',author:'Silent author',coverFinish:'glossy'},{redraw:false});
    view.updateEdgeAppearance({pageEdgeFinish:'matte'},{redraw:false});
    expect(gpu.renders.length).toBe(count);expect(model.userData.invalidate).toBe(invalidate);
    expect(cover(model).roughness).toBe(.18);expect(edge(model).roughness).toBeCloseTo(.35+.94*.6);
    view.updateAppearance(nextStyle({fontFamily:'Georgia',fontCanvasFamily:'Georgia'}),{reuseModel:true});
    expect(contexts.get(cover(model).map.image).texts.join(' ')).toContain('Silent generated title');
    expect(contexts.get(cover(model).map.image).texts).toContain('Silent author');
  });
  it('preserves deferred first-paint semantics while merging and applying both materials',() => {
    const {view}=make();const model=allModels().at(-1),count=gpu.renders.length;
    view.draw({...pose,angle:44},{redraw:false});
    expect(view.updateEditorAppearance({coverFinish:'glossy',pageEdgeFinish:'matte'})).toBe(true);
    expect(gpu.renders.length).toBe(count);expect(cover(model).roughness).toBe(.18);
    view.draw(view.getPose());expect(gpu.renders.length-count).toBe(1);expect(view.getPose().angle).toBe(44);
  });
  it('restores the real asynchronous invalidation callback after each silent mutation and batch',() => {
    const {view}=make();view.draw({...pose,angle:67});const model=liveModel(),invalidate=model.userData.invalidate;
    view.updateEditorAppearance({coverFinish:'glossy',pageEdgeFinish:'matte'});
    expect(model.userData.invalidate).toBe(invalidate);const count=gpu.renders.length;
    model.userData.invalidate();expect(gpu.renders.length-count).toBe(1);expect(view.getPose().angle).toBe(67);
  });
  it('coalesces an actual synchronous relief removal and edge change into one committed render',async () => {
    const {view}=make();view.draw(pose);await view.setCoverRelief(relief);
    const model=liveModel(),normal=cover(model).clearcoatNormalMap,count=gpu.renders.length,invalidate=model.userData.invalidate;
    expect(view.updateEditorAppearance({coverRelief:null,pageEdgeFinish:'matte'})).toBe(true);
    expect(model.userData.coverRelief()).toBeNull();expect(cover(model).clearcoatNormalMap).not.toBe(normal);
    expect(gpu.renders.length-count).toBe(1);expect(model.userData.invalidate).toBe(invalidate);
  });
  it('allows a genuine later relief bake to repaint after the single synchronous batch frame',async () => {
    const {view}=make();view.draw(pose);const model=liveModel(),invalidate=model.userData.invalidate;
    let resolve;const ready=new Promise(done=>resolve=done);vi.mocked(buildReliefMaps).mockImplementationOnce(()=>ready);
    const count=gpu.renders.length;view.updateEditorAppearance({coverRelief:relief,pageEdgeFinish:'matte'});
    expect(gpu.renders.length-count).toBe(1);expect(model.userData.invalidate).toBe(invalidate);
    await vi.waitFor(()=>expect(buildReliefMaps).toHaveBeenCalledOnce());const frameCount=gpu.renders.length;
    resolve(maps());await vi.waitFor(()=>expect(gpu.renders.length).toBeGreaterThan(frameCount));
    expect(model.userData.coverRelief()).toEqual(relief);expect(model.userData.invalidate).toBe(invalidate);
  });
  it('restores both pending and live invalidation callbacks when a synchronous mutation throws',() => {
    const {view}=make({coverUrl:'blob:batch-error'});view.draw(pose);
    const visible=liveModel();view.updateAppearance(nextStyle({color:'#713b42'}),{reuseModel:true});
    const pending=allModels().at(-1);pending.userData.invalidate=vi.fn();
    const previous=[pending.userData.invalidate,visible.userData.invalidate],count=gpu.renders.length;
    vi.spyOn(visible.userData,'updateEdgeAppearance').mockImplementationOnce(()=>{throw new Error('Exact material failure');});
    expect(()=>view.updateEditorAppearance({coverFinish:'glossy',pageEdgeFinish:'matte'})).toThrow('Exact material failure');
    expect(pending.userData.invalidate).toBe(previous[0]);expect(visible.userData.invalidate).toBe(previous[1]);
    expect(gpu.renders.length).toBe(count);visible.userData.invalidate();expect(gpu.renders.length-count).toBe(1);
  });
  it('does nothing after disposal and retains existing false return values',() => {
    const {view}=make();view.draw(pose);const model=liveModel(),spies=mutateSpies(model);view.dispose();const count=gpu.renders.length;
    expect(view.updateEditorAppearance({coverFinish:'glossy'})).toBe(false);
    expect(view.updateCoverAppearance({coverFinish:'glossy'},{redraw:false})).toBe(false);
    expect(view.updateEdgeAppearance({pageEdgeFinish:'matte'},{redraw:false})).toBe(false);
    expect(spies.cover).not.toHaveBeenCalled();expect(spies.edge).not.toHaveBeenCalled();expect(gpu.renders.length).toBe(count);
  });
  it('restores captured callbacks if disposal occurs inside a synchronous mutation and skips its final paint',() => {
    const {view}=make();view.draw(pose);const model=liveModel(),invalidate=model.userData.invalidate,count=gpu.renders.length;
    const edgeUpdate=vi.spyOn(model.userData,'updateEdgeAppearance');
    vi.spyOn(model.userData,'updateCoverAppearance').mockImplementationOnce(()=>view.dispose());
    expect(view.updateEditorAppearance({coverFinish:'glossy'})).toBe(false);
    expect(model.userData.invalidate).toBe(invalidate);expect(edgeUpdate).not.toHaveBeenCalled();expect(gpu.renders.length).toBe(count);
  });
  it('paints real full-record cover and edge changes even when the caller was triggered by a spine input',() => {
    const {view}=make({}, {coverFinish:'satin',pageEdgeFinish:'satin'});view.draw(pose);
    const model=liveModel(),count=gpu.renders.length;
    view.updateEditorAppearance({spineTitleOverride:'Latest spine',coverFinish:'glossy',pageEdgeFinish:'matte'});
    expect(gpu.renders.length-count).toBe(1);expect(cover(model).roughness).toBe(.18);
    expect(edge(model).roughness).toBeCloseTo(.35+.94*.6);
  });
});
