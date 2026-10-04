import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import * as THREE from 'three';
import { createBookshelfScene } from '../../src/js/bookshelf-scene.js';

const gpu = vi.hoisted(() => ({ renderer:null,scene:null,models:[],plans:[],paints:[] }));
vi.mock('../../src/js/book-model.js',async () => {
  const Three = await import('three');
  let ratio = 1;
  const size = new Three.Vector2();
  gpu.renderer = { domElement:document.createElement('canvas'),shadowMap:{},
    capabilities:{ getMaxAnisotropy:() => 1 },getPixelRatio:() => ratio,
    setPixelRatio:value => { ratio = value; },getSize:target => target.copy(size),
    setSize:(width,height) => size.set(width,height),
    render:vi.fn(scene => {
      scene.updateMatrixWorld(); gpu.scene = scene;
      const book = scene.getObjectByName('book:one');
      gpu.paints.push(book ? { model:book,dimensions:[...book.userData.createdDimensions],relief:book.userData.reliefApplied } : null);
    }) };
  return { getBookRenderer:() => gpu.renderer,lightBookScene() {},
    createBookModel(book,_style,width,height,thickness,_cover,options = {}) {
      const plan = gpu.plans.shift() || { coverLoaded:true,ready:Promise.resolve(true) };
      const model = new Three.Group(); model.name = `book:${book.id}`;
      const binding = new Three.Mesh(new Three.BoxGeometry(thickness * .38,height,thickness),new Three.MeshStandardMaterial());
      binding.name = 'binding'; binding.position.x = -width / 2 - thickness * .19; model.add(binding);
      model.userData.createdDimensions = [width,height,thickness];
      model.userData.overview = Boolean(options.overview);
      model.userData.inspectionResolution = options.inspectionResolution || 0;
      model.userData.dispose = vi.fn(); model.userData.ready = plan.ready;
      model.userData.coverLoaded = plan.coverLoaded;
      model.userData.updateBookmark = vi.fn();
      model.userData.updateCoverSource = vi.fn();
      if (plan.reliefReady) {
        model.userData.reliefApplied = false;
        plan.reliefReady.then(() => { model.userData.reliefApplied = true; model.userData.invalidate?.(); });
      }
      gpu.models.push(model); return model;
    } };
});

let shelf,stage,scroller,node,frames,clock,book,style,rows;
const rect = (width,height) => ({ left:0,top:60,width,height,right:width,bottom:60+height });
const model = () => gpu.scene.getObjectByName('book:one');
const deferred = () => {
  let resolve,reject;
  const promise = new Promise((accept,fail) => { resolve = accept; reject = fail; });
  return { promise,resolve,reject };
};
function drain() {
  let count = 0;
  while (frames.size && count++ < 120) {
    clock += 16; const current = [...frames.values()]; frames.clear();
    for (const callback of current) callback(clock);
  }
  expect(count).toBeLessThan(120);
}
function resize({ width = 143,height = 95.33333333333331,thickness = 28,coverUrl = 'cover:new' } = {}) {
  shelf.updateLayout({ stage,width:390,height:500,rows,
    entries:[{ node,book,style:{ ...style,coverRatio:width/height,width:thickness },coverUrl,
      x:75,y:220-height/2,width,height,thickness }] });
}
beforeEach(async () => {
  clock = 0; frames = new Map(); gpu.models = []; gpu.plans = []; gpu.paints = []; let serial = 0;
  vi.stubGlobal('requestAnimationFrame',callback => { const id = ++serial; frames.set(id,callback); return id; });
  vi.stubGlobal('cancelAnimationFrame',id => frames.delete(id));
  vi.spyOn(performance,'now').mockImplementation(() => clock);
  vi.spyOn(THREE.TextureLoader.prototype,'load').mockImplementation(() => new THREE.Texture());
  vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockImplementation(() => ({
    createImageData:(width,height) => ({ data:new Uint8ClampedArray(width*height*4) }),putImageData() {},drawImage() {},clearRect() {}
  }));
  vi.stubGlobal('matchMedia',() => ({ matches:false }));
  scroller = document.createElement('div'); stage = document.createElement('div'); scroller.append(stage); document.body.append(scroller);
  Object.defineProperty(scroller,'clientHeight',{ value:700 });
  scroller.getBoundingClientRect = () => rect(390,700); stage.getBoundingClientRect = () => rect(390,500);
  node = document.createElement('button'); node.className = 'ihr-spine'; node.dataset.bookId = 'one'; stage.append(node);
  rows = [{ top:20,bottom:220 },{ top:260,bottom:460 }];
  book = { id:'one',title:'Same book',progressFraction:.1 }; style = { color:'#41694f',width:28,coverRatio:100/180 };
  shelf = createBookshelfScene({ stage,scroller,width:390,height:500,rows,
    entries:[{ node,book,style,coverUrl:'cover:old',x:75,y:130,width:100,height:180,thickness:28 }] });
  shelf.canvas.getBoundingClientRect = () => rect(390,700);
  await Promise.resolve(); shelf.flush({ force:true }); drain(); gpu.renderer.render.mockClear(); gpu.paints = [];
});
afterEach(() => { shelf?.dispose(); document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('pending shelf record replacements',() => {
  it('retains an identical pending geometry, cover and material target across fresh metadata records',async () => {
    const ready = deferred(),previous = model();
    gpu.plans.push({ coverLoaded:false,ready:ready.promise }); resize();
    const replacement = gpu.models.at(-1);
    book = { ...book,lastOpenedAt:123,wordCount:78000,wordCountComplete:true };
    resize(); resize();
    expect(gpu.models).toHaveLength(2);
    expect(model()).toBe(previous); expect(replacement.userData.dispose).not.toHaveBeenCalled();
    ready.resolve(true); await Promise.resolve(); drain();
    expect(model()).toBe(replacement);
    expect(replacement.userData.entry.book).toBe(book);
    expect(previous.userData.dispose).toHaveBeenCalledTimes(1);
    expect(replacement.userData.dispose).not.toHaveBeenCalled();
  });

  it('supersedes a pending model when a real material changes even with identical physical geometry',async () => {
    const obsoleteReady = deferred(),currentReady = deferred(),previous = model();
    gpu.plans.push({ coverLoaded:false,ready:obsoleteReady.promise }); resize();
    const obsolete = gpu.models.at(-1);
    book = { ...book,coverFinish:'glossy' };
    gpu.plans.push({ coverLoaded:false,ready:currentReady.promise }); resize();
    const current = gpu.models.at(-1);
    expect(gpu.models).toHaveLength(3);
    expect(current).not.toBe(obsolete);
    expect(current.userData.createdDimensions).toEqual(obsolete.userData.createdDimensions);
    expect(obsolete.userData.dispose).toHaveBeenCalledTimes(1);
    obsoleteReady.resolve(true); await Promise.resolve(); drain();
    expect(model()).toBe(previous);
    currentReady.resolve(true); await Promise.resolve(); drain();
    expect(model()).toBe(current);
    expect(current.userData.entry.book).toBe(book);
    expect(obsolete.userData.dispose).toHaveBeenCalledTimes(1);
  });

  it('applies the latest progress to the retained pending ribbon and commits that same model',async () => {
    const ready = deferred(),previous = model();
    gpu.plans.push({ coverLoaded:false,ready:ready.promise }); resize();
    const replacement = gpu.models.at(-1);
    book = { ...book,progressFraction:.73,lastOpenedAt:456 };
    resize();
    expect(gpu.models).toHaveLength(2);
    expect(model()).toBe(previous);
    expect(replacement.userData.updateBookmark).toHaveBeenCalledTimes(1);
    expect(replacement.userData.updateBookmark).toHaveBeenLastCalledWith(book);
    expect(replacement.userData.shelfKeys.bookmark).toContain('0.73');
    ready.resolve(true); await Promise.resolve(); drain();
    expect(model()).toBe(replacement);
    expect(replacement.userData.entry.book.progressFraction).toBe(.73);
    expect(replacement.userData.updateBookmark).toHaveBeenCalledTimes(1);
    expect(previous.userData.dispose).toHaveBeenCalledTimes(1);
  });

  it.each(['failed','rejected'])('preserves the previous real cover when a retained decode is %s',async outcome => {
    const ready = deferred(),previous = model();
    gpu.plans.push({ coverLoaded:false,ready:ready.promise }); resize();
    const replacement = gpu.models.at(-1);
    book = { ...book,progressFraction:.73,lastOpenedAt:789 };
    resize();
    expect(gpu.models).toHaveLength(2);
    if(outcome === 'failed')ready.resolve(false);else ready.reject(new Error('decode failed'));
    await Promise.resolve(); drain();
    expect(model()).toBe(previous);
    expect(previous.userData.dispose).not.toHaveBeenCalled();
    expect(replacement.parent).toBeNull();
    expect(replacement.userData.dispose).toHaveBeenCalledTimes(1);
    expect(previous.userData.updateCoverSource).toHaveBeenLastCalledWith('cover:new',book,expect.any(Object));
    expect(previous.userData.updateBookmark).toHaveBeenCalledTimes(1);
    expect(previous.userData.updateBookmark).toHaveBeenLastCalledWith(book);
    expect(previous.userData.shelfKeys.bookmark).toContain('0.73');
    expect(gpu.paints.every(paint => paint.model === previous)).toBe(true);
  });
});
