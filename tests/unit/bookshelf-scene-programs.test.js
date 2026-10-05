import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { createBookshelfScene } from '../../src/js/bookshelf-scene.js';

// The renderer double links programs "in the background": they report ready
// only once the test says so, like KHR_parallel_shader_compile's completion.
const gpu = vi.hoisted(() => ({ renders:0, compiles:0, batches:[], linked:{ ready:false, isReady() { return this.ready; } } }));
vi.mock('../../src/js/book-model.js', async () => {
  const Three = await import('three');
  let ratio = 1, target = null;
  const size = new Three.Vector2();
  const renderer = { domElement:document.createElement('canvas'), shadowMap:{},
    capabilities:{ getMaxAnisotropy:() => 1 }, getPixelRatio:() => ratio,
    setPixelRatio:value => { ratio = value; }, getSize:output => output.copy(size),
    setSize:(width, height) => size.set(width, height), render() { gpu.renders++; },
    getRenderTarget:() => target, setRenderTarget(next) { target = next; },
    properties:{ get:() => ({ programs:new Map([['key', gpu.linked]]) }) },
    compile(listing, camera, scene) {
      gpu.scene = scene; gpu.compiles++; const materials = new Set(), names = [];
      listing.traverse(object => { materials.add(object.material); names.push(object.parent?.name.startsWith('book:') ? object.parent.name : object.name); });
      gpu.compiledMaterials = materials; gpu.batches.push(names); gpu.rendersBefore.push(gpu.renders); return materials;
    } };
  return { getBookRenderer:() => renderer, lightBookScene() {},
    createBookModel(book, style, width, height, thickness) {
      const model = new Three.Group(); model.name = `book:${book.id}`;
      const binding = new Three.Mesh(new Three.BoxGeometry(width, height, thickness), new Three.MeshStandardMaterial());
      binding.name = 'binding'; model.add(binding);
      model.userData.dispose = () => { binding.geometry.dispose(); binding.material.dispose(); };
      return model;
    } };
});

let shelf, stage, scroller, frames, clock;
const rect = (left, top, width, height) => ({ left, top, width, height, right:left + width, bottom:top + height });
function flushFrames() {
  for (let index = 0; frames.size && index < 100; index++) {
    clock += 16; const callbacks = [...frames.values()]; frames.clear();
    for (const callback of callbacks) callback(clock);
  }
}

beforeEach(() => {
  clock = 0; frames = new Map(); let serial = 0;
  Object.assign(gpu, { renders:0, compiles:0, scene:null, compiledMaterials:null, batches:[], rendersBefore:[] }); gpu.linked.ready = false;
  vi.useFakeTimers({ toFake:['setTimeout', 'clearTimeout'] });
  vi.stubGlobal('requestAnimationFrame', callback => { const id = ++serial; frames.set(id, callback); return id; });
  vi.stubGlobal('cancelAnimationFrame', id => frames.delete(id));
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
  vi.spyOn(THREE.TextureLoader.prototype, 'load').mockImplementation(() => new THREE.Texture());
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ({
    createImageData:(width, height) => ({ data:new Uint8ClampedArray(width * height * 4) }),
    putImageData() {}, drawImage() {}, clearRect() {}
  }));
  window.matchMedia = () => ({ matches:false });
  scroller = document.createElement('div'); stage = document.createElement('div');
  scroller.append(stage); document.body.append(scroller);
  Object.defineProperty(scroller, 'clientHeight', { value:700 });
  scroller.getBoundingClientRect = () => rect(0, 60, 390, 700);
  stage.getBoundingClientRect = () => rect(0, 60, 390, parseFloat(stage.style.height) || 715);
});
afterEach(() => {
  shelf?.dispose(); shelf = null; document.body.innerHTML = '';
  vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

function layout() {
  const rows = [{ top:20, ceiling:12, bottom:220 }, { top:250, ceiling:235, bottom:450 }];
  const entries = [0, 1].map(index => {
    const node = document.createElement('button'); node.className = 'ihr-spine'; node.dataset.bookId = `book-${index}`;
    stage.append(node);
    return { node, book:{ id:`book-${index}`, title:`Book ${index}` }, style:{ color:'#335577', shade:'#223344', ink:'#fff' },
      x:60 + index * 40, y:170, height:150, width:100, thickness:24, shelf:0, depthInset:0 };
  });
  return { stage, scroller, width:390, sceneWidth:390, height:715, rows, entries };
}

describe('first frame of the shelf scene', () => {
  it('waits for every program to finish linking, without blocking, before it renders', () => {
    shelf = createBookshelfScene(layout());
    shelf.canvas.getBoundingClientRect = () => rect(0, 60, 390, 700);
    flushFrames();
    const compiles = gpu.compiles;
    expect(gpu.renders).toBe(0);
    expect(shelf.canvas.dataset.renderCount).toBeUndefined();

    // Still linking: polling repeats without compiling the scene again or
    // asking for another frame (which would rerun the whole update step).
    vi.advanceTimersByTime(30);
    expect(frames.size).toBe(0);
    expect(gpu.compiles).toBe(compiles);
    expect(gpu.renders).toBe(0);

    gpu.linked.ready = true;
    vi.advanceTimersByTime(10); flushFrames();
    expect(gpu.renders).toBeGreaterThan(0);
    expect(shelf.canvas.dataset.renderCount).toBe('1');
    expect(shelf.canvas.dataset.snapshotRenderCount).toBe('1');
  });

  it('links the room before its books exist, then each book as soon as it is built', () => {
    shelf = createBookshelfScene(layout());
    const books = ['book:book-0', 'book:book-1'];
    expect(gpu.batches[0]).toEqual(['Library room wall']);
    expect(gpu.batches[0].some(name => books.includes(name))).toBe(false);
    const own = books.map(book => gpu.batches.findIndex(names => names.length === 1 && names[0] === book));
    const whole = gpu.batches.length - 1;
    expect(own.every(index => index > 0 && index < whole)).toBe(true);
    expect(books.every(book => gpu.batches[whole].includes(book))).toBe(true);
    expect(gpu.rendersBefore.every(renders => renders === 0)).toBe(true);
  });

  it('renders immediately when the programs are already linked, as when a scene is rebuilt', () => {
    gpu.linked.ready = true;
    shelf = createBookshelfScene(layout());
    expect(gpu.renders).toBe(1);
    expect(shelf.canvas.dataset.renderCount).toBe('1');
    const compiles = gpu.compiles;
    shelf.flush(); flushFrames();
    expect(gpu.compiles).toBe(compiles);
  });

  it('prepares the hidden placement guide after the first frame, before the first drag, then reuses and disposes it', async () => {
    shelf = createBookshelfScene(layout());
    const marker = gpu.scene.getObjectByName('Shelf placement guide');
    expect(marker).toBeDefined();
    expect(marker.visible).toBe(false);
    expect(marker.children).toHaveLength(2);
    const material = marker.children[0].material;
    expect(marker.children[1].material).toBe(material);
    // The first frame never draws it, so it does not hold that frame back.
    expect(gpu.compiledMaterials.has(material)).toBe(false);
    expect(gpu.renders).toBe(0);
    const disposeMaterial = vi.spyOn(material, 'dispose');
    const disposeGeometry = marker.children.map(mesh => vi.spyOn(mesh.geometry, 'dispose'));
    gpu.linked.ready = true;
    vi.advanceTimersByTime(10); flushFrames();
    expect(gpu.renders).toBe(1);
    // Linked in the next idle slice, with the return's depth writers.
    await vi.advanceTimersByTimeAsync(100);
    expect(gpu.compiledMaterials.has(material)).toBe(true);
    expect(gpu.compiledMaterials.size).toBe(4);
    const compiles = gpu.compiles;
    shelf.setDropPosition({ shelf:0, x:.5 }); flushFrames();
    expect(marker.visible).toBe(true);
    expect(marker.children[0].material).toBe(material);
    expect(gpu.compiles).toBe(compiles);
    shelf.setDropPosition(null); flushFrames();
    expect(marker.visible).toBe(false);
    shelf.dispose(); shelf = null;
    expect(disposeMaterial).toHaveBeenCalledTimes(1);
    for (const dispose of disposeGeometry) expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('still resolves an animation that finished on a frame held back by linking', async () => {
    shelf = createBookshelfScene(layout());
    shelf.canvas.getBoundingClientRect = () => rect(0, 60, 390, 700);
    flushFrames();
    const motion = shelf.returnBook(shelf.canvas.parentElement.querySelector('.ihr-spine'), { duration:0 });
    flushFrames();
    expect(gpu.renders).toBe(0);
    let settled = false;
    motion.finished.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);

    gpu.linked.ready = true;
    vi.advanceTimersByTime(10); flushFrames();
    await motion.finished;
    expect(gpu.renders).toBeGreaterThan(0);
  });
});
