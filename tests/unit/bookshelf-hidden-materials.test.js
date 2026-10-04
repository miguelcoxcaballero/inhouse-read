import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import * as THREE from 'three';
import { createBookshelfScene } from '../../src/js/bookshelf-scene.js';

const gpu = vi.hoisted(() => ({ renderer:null,scene:null,models:[] }));
vi.mock('../../src/js/book-model.js',async () => {
  const Three = await import('three');
  let ratio = 1, scissorTest = false; const size = new Three.Vector2(), scissor = new Three.Vector4();
  gpu.renderer = { domElement:document.createElement('canvas'),shadowMap:{},
    capabilities:{ getMaxAnisotropy:() => 1 },getPixelRatio:() => ratio,
    setPixelRatio:value => { ratio = value; },getSize:target => target.copy(size),
    setSize:(width,height) => size.set(width,height),
    getScissorTest:() => scissorTest,setScissorTest:value => { scissorTest = value; },
    getScissor:target => target.copy(scissor),setScissor:(x,y,width,height) => {
      if (x?.isVector4) scissor.copy(x); else scissor.set(x,y,width,height);
    },clear() {},
    render:vi.fn(scene => { scene.updateMatrixWorld(); gpu.scene = scene; }) };
  return { getBookRenderer:() => gpu.renderer,lightBookScene() {},
    createBookModel(book,style,width,height,thickness,_cover,options = {}) {
      const model = new Three.Group(); model.name = `book:${book.id}`;
      const binding = new Three.Mesh(new Three.BoxGeometry(thickness * .38,height,thickness),new Three.MeshStandardMaterial());
      binding.name = 'binding'; binding.position.x = -width / 2 - thickness * .19; model.add(binding);
      model.userData.overview = Boolean(options.overview);
      model.userData.inspectionResolution = options.inspectionResolution || 0;
      model.userData.dispose = vi.fn(); model.userData.ready = Promise.resolve(true);
      model.userData.updateBookmark = vi.fn(next => { model.userData.savedProgress = next.progressFraction; model.userData.invalidate?.(); });
      model.userData.updateSpineAppearance = vi.fn(() => model.userData.invalidate?.());
      gpu.models.push(model); return model;
    } };
});

let shelf,stage,scroller,node,frames,clock,book,style;
const rect = (width,height) => ({ left:0,top:60,width,height,right:width,bottom:60+height });
const model = () => gpu.scene.getObjectByName('book:one');
const renders = () => gpu.renderer.render.mock.calls.length;
function drain() {
  let count = 0;
  while (frames.size && count++ < 120) {
    clock += 16; const current = [...frames.values()]; frames.clear();
    for (const callback of current) callback(clock);
  }
  expect(count).toBeLessThan(120);
}
function hideBook() { node.classList.add('is-away'); shelf.flush(); drain(); gpu.renderer.render.mockClear(); }
beforeEach(async () => {
  clock = 0; frames = new Map(); gpu.models = []; let serial = 0;
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
  book = { id:'one',title:'Same book',progressFraction:.1 }; style = { color:'#41694f',width:28 };
  shelf = createBookshelfScene({ stage,scroller,width:390,height:500,rows:[{ top:20,bottom:220 },{ top:260,bottom:460 }],
    entries:[{ node,book,style,x:75,y:130,width:100,height:180,thickness:28 }] });
  shelf.canvas.getBoundingClientRect = () => rect(390,700);
  await Promise.resolve(); shelf.flush({ force:true }); drain(); gpu.renderer.render.mockClear();
});
afterEach(() => { shelf?.dispose(); document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('material preparation of a book outside the shelf',() => {
  it('retains the painted empty slot while updating its hidden ribbon, then paints the latest ribbon on return',() => {
    const original = model(); hideBook();
    shelf.updateEntry(node,{ ...book,progressFraction:.6 },{ ...style },undefined);
    drain();
    expect(renders()).toBe(0); expect(shelf.flush()).toBe(false);
    expect(original.userData.updateBookmark).toHaveBeenCalledWith(expect.objectContaining({ progressFraction:.6 }));
    expect(original.userData.savedProgress).toBe(.6); expect(original.visible).toBe(false);
    node.classList.remove('is-away'); expect(shelf.flush()).toBe(true); drain();
    expect(model()).toBe(original); expect(original.visible).toBe(true);
    expect(original.userData.savedProgress).toBe(.6); expect(renders()).toBe(1);
  });
  it('defers hidden texture and lettering notifications, then respects the live class on restoration',() => {
    const original = model(); hideBook(); original.userData.invalidate();
    shelf.updateEntry(node,{ ...book,spineTitleOverride:'Updated title' },{ ...style },undefined); drain();
    expect(renders()).toBe(0); expect(frames.size).toBe(0);
    expect(original.userData.updateSpineAppearance).toHaveBeenCalled();
    node.classList.remove('is-away'); original.userData.invalidate(); drain();
    expect(renders()).toBe(1); expect(original.visible).toBe(true);
  });
  it('continues to paint material changes and decode callbacks on visible books',() => {
    const original = model(); original.userData.invalidate(); drain(); expect(renders()).toBe(1);
    shelf.updateEntry(node,{ ...book,progressFraction:.7 },{ ...style },undefined); drain();
    expect(renders()).toBe(2); expect(original.userData.savedProgress).toBe(.7);
  });
  it('continues to invalidate and commit structural changes while the book is hidden',async () => {
    hideBook(); shelf.updateEntry(node,{ ...book },{ ...style,width:42 },undefined);
    expect(frames.size).toBe(1); drain(); expect(renders()).toBe(1);
    await Promise.resolve(); drain();
    expect(renders()).toBe(2); expect(model().userData.entry.thickness).toBe(42);
  });
  it('paints material notifications during depth-tested insertion even while its semantic slot stays away',() => {
    hideBook(); const original = model();
    const overlay = document.createElement('canvas'); overlay.width = 390; overlay.height = 844;
    const insertion = shelf.returnBook(node,{ duration:180,overlayCanvas:overlay });
    expect(insertion).not.toBeNull(); gpu.renderer.render.mockClear();
    original.userData.invalidate(); drain();
    expect(renders()).toBeGreaterThan(0); expect(overlay.dataset.insertionDepth).toBe('shared-shelf');
    expect(shelf.canvas.dataset.returnProgress).toBe('1.0000');
    insertion.cancel();
  });
});
