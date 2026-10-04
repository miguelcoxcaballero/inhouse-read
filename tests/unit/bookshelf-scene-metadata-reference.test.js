import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { createBookshelfScene } from '../../src/js/bookshelf-scene.js';
import { createNativeRendererPresentation } from '../../src/js/native-renderer-presentation.js';

const gpu = vi.hoisted(() => ({ renderer:null, scene:null, creations:0, contextLost:false }));
vi.mock('../../src/js/book-model.js', async () => {
  const Three = await import('three'); let ratio = 1; const size = new Three.Vector2();
  gpu.renderer = { domElement:document.createElement('canvas'), shadowMap:{},
    capabilities:{ getMaxAnisotropy:() => 1 }, getPixelRatio:() => ratio,
    setPixelRatio:value => { ratio = value; }, getSize:target => target.copy(size),
    setSize:(width, height) => size.set(width, height), getContext:() => ({ isContextLost:() => gpu.contextLost }),
    render:vi.fn(scene => { scene.updateMatrixWorld(); gpu.scene = scene; }) };
  return { getBookRenderer:() => gpu.renderer, lightBookScene() {},
    createBookModel(book, _style, width, height, thickness, _cover, options = {}) {
      gpu.creations++;
      const model = new Three.Group(); model.name = `book:${book.id}`;
      const binding = new Three.Mesh(new Three.BoxGeometry(thickness * .38, height, thickness), new Three.MeshStandardMaterial());
      binding.name = 'binding'; binding.position.x = -width / 2 - thickness * .19; model.add(binding);
      Object.assign(model.userData, { overview:Boolean(options.overview), inspectionResolution:options.inspectionResolution || 0,
        ready:Promise.resolve(true), dispose:vi.fn() });
      return model;
    } };
});

let shelf, stage, scroller, books, entries, frames, clock, height, foreign;
const fonts = Object.getOwnPropertyDescriptor(document, 'fonts');
const rect = (left, top, width, height) => ({ left, top, width, height, right:left + width, bottom:top + height });
function drain() {
  let count = 0;
  while (frames.size && count++ < 120) {
    clock += 16; const callbacks = [...frames.values()]; frames.clear();
    for (const callback of callbacks) callback(clock);
  }
  expect(count).toBeLessThan(120);
}
const nextBooks = () => books.map(book => ({ ...book, progressDirty:false, progressUpdatedAt:12 }));
const adopt = (previous, next) => shelf.adoptMetadataRecords?.(previous, next) ?? false;
const model = id => gpu.scene.getObjectByName(`book:${id}`);

beforeEach(async () => {
  frames = new Map(); clock = 0; height = 700; foreign = null; gpu.contextLost = false; gpu.creations = 0;
  let serial = 0;
  vi.stubGlobal('requestAnimationFrame', callback => { const id = ++serial; frames.set(id, callback); return id; });
  vi.stubGlobal('cancelAnimationFrame', id => frames.delete(id));
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
  vi.spyOn(THREE.TextureLoader.prototype, 'load').mockImplementation(() => new THREE.Texture());
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ({
    createImageData:(width, height) => ({ data:new Uint8ClampedArray(width * height * 4) }), putImageData() {}, drawImage() {}, clearRect() {} }));
  vi.stubGlobal('matchMedia', () => ({ matches:false }));
  Object.defineProperty(document, 'fonts', { configurable:true, value:{ ready:new Promise(() => {}) } });
  scroller = document.createElement('div'); stage = document.createElement('div'); scroller.append(stage); document.body.append(scroller);
  Object.defineProperty(scroller, 'clientHeight', { get:() => height });
  scroller.getBoundingClientRect = () => rect(20, 60, 390, height);
  stage.getBoundingClientRect = () => rect(20, 60, 390, parseFloat(stage.style.height) || 500);
  books = ['a', 'b'].map(id => ({ id, title:`Book ${id}`, author:'Reader', format:'PDF', progressFraction:.37,
    locator:{ page:4 }, progressDirty:true, progressUpdatedAt:11 }));
  entries = books.map((book, i) => {
    const node = document.createElement('button'); node.className = 'ihr-spine'; node.dataset.bookId = book.id; stage.append(node);
    return { node, book, style:{ color:'#41694f', width:28 }, x:75 + i * 130, y:130, width:100, height:180, thickness:28 };
  });
  shelf = createBookshelfScene({ stage, scroller, entries, width:390, height:500,
    rows:[{ top:20, bottom:220 }, { top:260, bottom:460 }] });
  shelf.canvas.getBoundingClientRect = () => rect(20, 60, 390, height);
  await Promise.resolve(); shelf.flush({ force:true }); drain(); gpu.renderer.render.mockClear();
});
afterEach(() => {
  foreign?.dispose({ snapshot:false }); shelf?.dispose(); document.body.replaceChildren();
  vi.restoreAllMocks(); vi.unstubAllGlobals();
  if (fonts) Object.defineProperty(document, 'fonts', fonts); else delete document.fonts;
});

describe('scene metadata adoption validates a complete clean batch before mutating references', () => {
  it('adopts fresh references while keeping exact model/node/material/matrix/snapshot revisions and zero new renders', () => {
    const retained = books.map(book => model(book.id)), creations = gpu.creations;
    const before = JSON.stringify({ ...shelf.canvas.dataset });
    const transforms = retained.map(model => model.matrixWorld.toArray());
    const materials = retained.map(model => model.children[0].material), geometries = retained.map(model => model.children[0].geometry);
    const next = nextBooks(); expect(adopt(books, next)).toBe(true); drain();
    for (let i = 0; i < next.length; i++) {
      expect(model(next[i].id)).toBe(retained[i]); expect(retained[i].userData.entry.book).toBe(next[i]);
      expect(retained[i].userData.entry.node).toBe(entries[i].node);
      expect(retained[i].children[0].material).toBe(materials[i]); expect(retained[i].children[0].geometry).toBe(geometries[i]);
      expect(retained[i].matrixWorld.toArray()).toEqual(transforms[i]);
    }
    expect(gpu.creations).toBe(creations); expect(gpu.renderer.render).not.toHaveBeenCalled();
    expect(JSON.stringify({ ...shelf.canvas.dataset })).toBe(before); expect(shelf.flush()).toBe(false);
  });
  it('rejects stale, malformed, visual/order/unknown and disconnected batches without partially adopting another book', () => {
    const next = nextBooks();
    const cases = [[books, [next[0], { ...next[1], title:'Changed visible title' }]],
      [books, [next[0], { ...next[1], futureField:true }]], [books, next.slice().reverse()],
      [books, next.slice(0, 1)], [books.map(book => ({ ...book })), next]];
    for (const [previous, changed] of cases) {
      expect(adopt(previous, changed)).toBe(false);
      for (const book of books) expect(model(book.id).userData.entry.book).toBe(book);
    }
    entries[1].node.remove(); expect(adopt(books, next)).toBe(false);
    expect(model(books[0].id).userData.entry.book).toBe(books[0]);
    expect(gpu.renderer.render).not.toHaveBeenCalled();
  });
  it('preserves pending paints, live state/viewport/theme changes, held/hidden/context loss and foreign ownership', () => {
    const next = nextBooks();
    shelf.invalidate(); expect(adopt(books, next)).toBe(false); expect(shelf.flush()).toBe(true); drain();
    entries[0].node.classList.add('is-away'); expect(adopt(books, next)).toBe(false); shelf.flush(); drain();
    entries[0].node.classList.remove('is-away'); shelf.flush(); drain();
    height = 620; expect(adopt(books, next)).toBe(false); shelf.flush(); drain();
    shelf.setPaintHeld(true); expect(adopt(books, next)).toBe(false); shelf.setPaintHeld(false); shelf.flush(); drain();
    shelf.setPresentationActive(false); expect(adopt(books, next)).toBe(false); shelf.setPresentationActive(true); shelf.flush(); drain();
    document.documentElement.dataset.theme = 'night'; expect(adopt(books, next)).toBe(false); shelf.flush(); drain();
    document.documentElement.removeAttribute('data-theme'); shelf.flush(); drain();
    gpu.contextLost = true; expect(adopt(books, next)).toBe(false); gpu.contextLost = false;
    const output = document.createElement('canvas'); document.body.append(output);
    foreign = createNativeRendererPresentation(gpu.renderer, { canvas:output, context:{}, capture() {}, repaint() {},
      position:node => { document.body.append(node); return true; } });
    expect(foreign.present()).toBe(true); expect(adopt(books, next)).toBe(false); expect(foreign.isOwner()).toBe(true);
    for (const book of books) expect(model(book.id).userData.entry.book).toBe(book);
  });
});
