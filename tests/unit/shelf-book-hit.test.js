import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { createBookshelfScene } from '../../src/js/bookshelf-scene.js';
import { layoutShelves } from '../../src/js/bookshelf-layout.js';
import { bookSpineOptions, minimumBookCellWidth, minimumBookTapWidth, nearestTapTarget, padTapRect } from '../../src/js/plant-dimensions.js';

vi.mock('../../src/js/book-model.js', async () => {
  const Three = await import('three');
  let ratio = 1, size = new Three.Vector2();
  const renderer = { domElement:document.createElement('canvas'), shadowMap:{},
    capabilities:{ getMaxAnisotropy:() => 1 }, getPixelRatio:() => ratio,
    setPixelRatio:value => { ratio = value; }, getSize:target => target.copy(size),
    setSize:(width, height) => { size.set(width, height); }, render() {} };
  return { getBookRenderer:() => renderer, lightBookScene() {},
    createBookModel(book, style, width, height, thickness) {
      const model = new Three.Group(); model.name = `book:${book.id}`;
      model.add(new Three.Mesh(new Three.BoxGeometry(width, height, thickness), new Three.MeshStandardMaterial()));
      const binding = new Three.Mesh(new Three.BoxGeometry(thickness * .38, height, thickness), new Three.MeshStandardMaterial());
      binding.name = 'binding'; binding.position.x = -width / 2 - thickness * .19; model.add(binding);
      model.userData.dispose = () => {};
      return model;
    } };
});

const STAGE = { left:20, top:60, width:390 };
let clock, frames, shelf, stage, scroller;
function rect(left, top, width, height) { return { left, top, width, height, right:left + width, bottom:top + height }; }
function flushFrames(duration = 600) {
  const end = clock + duration;
  while (frames.size && clock < end) {
    clock += 16;
    const callbacks = [...frames.values()]; frames.clear();
    for (const callback of callbacks) callback(clock);
  }
}
const library = count => Array.from({ length:count }, (_, index) => ({ id:`local:book-${index}:${index * 977}`, title:`Libro ${index}`, author:'Autor' }));
const tapWidth = minimumBookTapWidth(390);

/** The scene-level entries of books standing in `cells` ({ x, thickness, row }) on three rows. */
function mount(cells) {
  const rows = [0, 1, 2].map(index => ({ top:20 + index * 220, bottom:220 + index * 220 }));
  const books = library(cells.length);
  const entries = cells.map(({ x, thickness, row }, index) => {
    const node = document.createElement('button'); node.classList.add('ihr-spine'); node.dataset.bookId = String(index); stage.append(node);
    return { node, book:books[index], style:{ color:'#41694f', width:thickness }, shelf:row,
      x, y:rows[row].bottom - 86, width:100, height:172, thickness };
  });
  shelf.updateLayout({ stage, width:390, sceneWidth:390, height:rows.at(-1).bottom + 35, rows, entries });
  shelf.flush(); flushFrames();
  return entries;
}
/** The button's box in client pixels, as the DOM would give it. */
function box(node) {
  const left = STAGE.left + parseFloat(node.style.left), top = STAGE.top + parseFloat(node.style.top);
  return { left, top, width:parseFloat(node.style.width), height:parseFloat(node.style.height) };
}

beforeEach(() => {
  clock = 0; frames = new Map();
  let serial = 0;
  vi.stubGlobal('requestAnimationFrame', callback => { const id = ++serial; frames.set(id, callback); return id; });
  vi.stubGlobal('cancelAnimationFrame', id => frames.delete(id));
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
  vi.spyOn(THREE.TextureLoader.prototype, 'load').mockImplementation(() => new THREE.Texture());
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ({
    createImageData:(width, height) => ({ data:new Uint8ClampedArray(width * height * 4) }), putImageData() {}, drawImage() {}, clearRect() {}
  }));
  window.matchMedia = () => ({ matches:false });
  Object.defineProperty(window, 'innerWidth', { configurable:true, value:390 });
  scroller = document.createElement('div'); stage = document.createElement('div');
  scroller.append(stage); document.body.append(scroller);
  Object.defineProperty(scroller, 'clientHeight', { value:700 });
  scroller.getBoundingClientRect = () => rect(STAGE.left, STAGE.top, 390, 700);
  stage.getBoundingClientRect = () => rect(STAGE.left, STAGE.top, 390, 750);
  const first = document.createElement('button'); stage.append(first);
  shelf = createBookshelfScene({ stage, scroller, width:390, sceneWidth:390, height:750,
    rows:[{ top:20, bottom:220 }], entries:[{ node:first, book:{ id:'a', title:'Book', author:'Autor' }, style:{ color:'#3c6548', width:28 },
      x:60, y:130, width:100, height:172, thickness:28 }] });
  shelf.canvas.getBoundingClientRect = () => rect(STAGE.left, STAGE.top, 390, 700);
});

afterEach(() => {
  shelf?.dispose(); shelf = null; document.body.innerHTML = '';
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});

describe('padTapRect and nearestTapTarget', () => {
  it('widens a thin spine around its centre and leaves a wide one alone', () => {
    expect(padTapRect({ left:100, top:5, width:6, height:50 }, 16)).toEqual({ left:95, top:5, width:16, height:50 });
    expect(padTapRect({ left:100, top:5, width:30, height:50 }, 16)).toEqual({ left:100, top:5, width:30, height:50 });
    const out = {}; expect(padTapRect({ left:0, top:0, width:5, height:9 }, 18, out)).toBe(out);
    expect(minimumBookTapWidth(390)).toBe(minimumBookCellWidth(390)); expect(minimumBookTapWidth(1280)).toBe(18);
  });

  it('picks the nearest centre where padded rectangles overlap, and null outside all of them', () => {
    const a = { id:'a', left:0, top:0, width:16, height:50 }, b = { id:'b', left:10, top:0, width:16, height:50 };
    expect(nearestTapTarget([a, b], 9, 20).id).toBe('a');
    expect(nearestTapTarget([a, b], 10, 20).id).toBe('a');
    expect(nearestTapTarget([a, b], 12, 20).id).toBe('a'); // 4 from a's centre (8), 6 from b's (18)
    expect(nearestTapTarget([a, b], 14, 20).id).toBe('b'); // 4 from b's centre, 6 from a's
    expect(nearestTapTarget([b, a], 14, 20).id).toBe('b'); // never the order of the list
    expect(nearestTapTarget([a, b], 40, 20)).toBeNull();
    expect(nearestTapTarget([a, b], 5, 80)).toBeNull();
  });
});

describe('every real-scale book can be tapped', () => {
  it('hits each of 30 books of a 390 px shelf at its own centre, with a tap area of at least 16 px', () => {
    const books = library(30).map((book, index) => ({ ...book,
      wordCount:[100, 300, 600][index % 3] * 300, wordCountVersion:2, wordCountComplete:true }));
    const shelves = layoutShelves(books, { shelfWidth:390, padding:16, gap:3, plantEvery:Infinity, maxTailPlants:0,
      spine:bookSpineOptions(390), displayWidthFor:(_book, style) => Math.max(style.width, minimumBookCellWidth(390)) });
    const cells = shelves.flatMap((row, rowIndex) => {
      let x = 16;
      return row.items.map(item => { const cell = { x:x + item.width / 2, thickness:item.style.width, row:Math.min(2, rowIndex) }; x += item.width + 3; return cell; });
    });
    expect(cells).toHaveLength(30);
    expect(Math.min(...cells.map(cell => cell.thickness))).toBeLessThan(tapWidth); // thin books really are thinner than a tap
    expect(Math.max(...cells.map(cell => cell.thickness))).toBeGreaterThan(tapWidth); // longer books keep their real width
    const entries = mount(cells);
    const boxes = entries.map(entry => box(entry.node));
    entries.forEach((entry, index) => {
      expect(boxes[index].width).toBeGreaterThanOrEqual(tapWidth - 1e-6);
      expect(boxes[index].width).toBeGreaterThanOrEqual(cells[index].thickness * .38 - 1e-6);
      const x = boxes[index].left + boxes[index].width / 2, y = boxes[index].top + boxes[index].height / 2;
      expect(shelf.getBookAtPoint(x, y), `book ${index}`).toBe(entry.node);
      expect(shelf.getObjectAtPoint(x, y), `object ${index}`).toBe(entry.node);
    });
  });

  it('hits a thin spine across its whole padded width, even where the ray falls between two books', () => {
    const entries = mount([{ x:100, thickness:10, row:0 }, { x:200, thickness:10, row:0 }]);
    for (const entry of entries) {
      const { left, width, top, height } = box(entry.node);
      expect(width).toBeGreaterThanOrEqual(tapWidth - 1e-6);
      for (const fraction of [.08, .5, .92]) expect(shelf.getBookAtPoint(left + width * fraction, top + height / 2)).toBe(entry.node);
    }
    expect(shelf.getBookAtPoint(150, 120)).toBeNull(); // empty shelf between the two books
  });

  it('gives a tap between two crowded thin spines to the nearer one, never to the neighbour drawn last', () => {
    // Cells 10 px apart: padded 16 px rectangles overlap by 6 px.
    const cells = Array.from({ length:12 }, (_, index) => ({ x:40 + index * 10, thickness:7, row:0 }));
    const entries = mount(cells);
    const boxes = entries.map(entry => box(entry.node));
    expect(boxes[1].left).toBeLessThan(boxes[0].left + boxes[0].width); // the padded rectangles do overlap
    const centre = index => boxes[index].left + boxes[index].width / 2, y = boxes[0].top + boxes[0].height / 2;
    entries.forEach((entry, index) => expect(shelf.getBookAtPoint(centre(index), y), `centre ${index}`).toBe(entry.node));
    for (let index = 0; index < entries.length - 1; index++) {
      const middle = (centre(index) + centre(index + 1)) / 2;
      expect(shelf.getBookAtPoint(middle - 1.5, y), `left of ${index}|${index + 1}`).toBe(entries[index].node);
      expect(shelf.getBookAtPoint(middle + 1.5, y), `right of ${index}|${index + 1}`).toBe(entries[index + 1].node);
    }
  });
});
