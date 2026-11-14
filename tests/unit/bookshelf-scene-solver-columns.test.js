import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { createBookshelfScene } from '../../src/js/bookshelf-scene.js';
import { SHELF_SPECS } from '../../src/js/shelf-types.js';

// The rigid bodies read nine numbers of every entry from the entry arena (columns 40-48: its
// thickness or width, kind, shelf, pixels per metre, the bay's left, right, bottom and ceiling,
// and the grip). The scene wrote them for every entry in every frame (1.7.334, the expression
// frozen in `wanted` below); it now writes them only with the entry's size and place. At every
// call that steps the bodies, the arena must hold exactly what the frozen expression gives for
// the scene's entries as they are then: after the first frame, quiet frames, a new layout with
// other bays, a grip and a record with another thickness.
const audit = vi.hoisted(() => ({ entries:[], rows:[], width:0, pixelsPerMetre:0, checks:0, misses:[] }));
vi.mock('../../src/js/scene-entry-frame.js', async actual => {
  const real = await actual();
  const wanted = entry => {
    const plant = entry.kind === 'plant', lamp = entry.kind === 'lamp', undershelf = lamp && entry.mount === 'undershelf', kind = plant ? 1 : lamp ? 2 : 0;
    const row = audit.rows[entry.shelf || 0] || audit.rows[0] || {};
    return [kind ? entry.width : entry.thickness, undershelf ? 3 : kind, entry.shelf || 0, audit.pixelsPerMetre, row.left || 0, row.right ?? audit.width,
      row.bottom ?? entry.y + entry.height / 2, row.ceiling ?? row.top ?? 0, entry.gripHeight || 0];
  };
  return { ...real, createSceneEntryFrame(rust) {
    const frame = real.createSceneEntryFrame(rust), bind = frame.bind;
    frame.bind = (list, ...rest) => { audit.entries = list; return bind(list, ...rest); };
    for (const name of ['settle', 'settled']) { const original = frame[name]; frame[name] = (...args) => {
      frame.refresh(); audit.checks++;
      audit.entries.forEach((entry, index) => wanted(entry).forEach((value, column) => {
        const held = frame.state[index * real.ENTRY_STATE + 40 + column];
        if (!Object.is(held, value)) audit.misses.push(`${name}: entry ${index} column ${40 + column}: the arena holds ${held}, the entry gives ${value}`);
      }));
      return original(...args);
    }; }
    return frame;
  } };
});
vi.mock('../../src/js/book-model.js', async () => {
  const Three = await import('three'); let ratio = 1; const size = new Three.Vector2();
  const renderer = { domElement:document.createElement('canvas'), shadowMap:{}, capabilities:{ getMaxAnisotropy:() => 1 }, getPixelRatio:() => ratio,
    setPixelRatio:value => { ratio = value; }, getSize:target => target.copy(size), setSize:(width, height) => size.set(width, height),
    getContext:() => ({ isContextLost:() => false }), render:scene => { scene.updateMatrixWorld(); } };
  return { getBookRenderer:() => renderer, lightBookScene() {},
    createBookModel(book, _style, width, height, thickness) {
      const model = new Three.Group(); model.name = `book:${book.id}`;
      const binding = new Three.Mesh(new Three.BoxGeometry(thickness * .38, height, thickness), new Three.MeshStandardMaterial());
      binding.name = 'binding'; binding.position.x = -width / 2 - thickness * .19; model.add(binding);
      Object.assign(model.userData, { ready:Promise.resolve(true), dispose() {} });
      return model;
    } };
});

let shelf, stage, scroller, frames, clock;
const fonts = Object.getOwnPropertyDescriptor(document, 'fonts');
const rect = (left, top, width, height) => ({ left, top, width, height, right:left + width, bottom:top + height });
function drain(limit = 40) {
  for (let count = 0; frames.size && count < limit; count++) {
    clock += 16; const callbacks = [...frames.values()]; frames.clear();
    for (const callback of callbacks) callback(clock);
  }
}
function layout(rows, width, thicknesses) {
  const entries = thicknesses.map((thickness, index) => {
    const node = document.createElement('button'); node.className = 'ihr-spine'; node.dataset.bookId = `b${index}`; stage.append(node);
    node.getBoundingClientRect = () => rect(40 + index * 60, 100, 30, 180);
    const book = { id:`b${index}`, title:`Book ${index}`, author:'Reader', format:'PDF' };
    return { node, book, style:{ color:'#41694f', width:thickness }, x:60 + index * 70, y:rows[index % rows.length].bottom - 90, width:100, height:180, thickness, shelf:index % rows.length };
  });
  audit.rows = rows; audit.width = width; audit.pixelsPerMetre = width / SHELF_SPECS.walnut.width * 1000;
  return { stage, scroller, entries, width, height:rows.at(-1).bottom + 40, rows };
}
const settle = () => { shelf.invalidate(); shelf.flush({ force:true }); drain(); };

beforeEach(() => {
  frames = new Map(); clock = 0; audit.checks = 0; audit.misses.length = 0;
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
  Object.defineProperty(scroller, 'clientHeight', { get:() => 700 });
  scroller.getBoundingClientRect = () => rect(20, 60, 390, 700);
  stage.getBoundingClientRect = () => rect(20, 60, 390, parseFloat(stage.style.height) || 500);
});
afterEach(() => {
  shelf?.dispose(); shelf = null; document.body.replaceChildren();
  vi.restoreAllMocks(); vi.unstubAllGlobals();
  if (fonts) Object.defineProperty(document, 'fonts', fonts); else delete document.fonts;
});

it('holds the solver\'s columns of every entry as the per-frame writes did, through layouts, grips and records', async () => {
  const first = layout([{ top:20, ceiling:12, bottom:220 }, { top:260, bottom:460, left:8, right:380 }], 390, [28, 22, 31, 18]);
  shelf = createBookshelfScene(first);
  shelf.canvas.getBoundingClientRect = () => rect(20, 60, 390, 700);
  await Promise.resolve(); settle();
  const afterFirst = audit.checks; expect(afterFirst).toBeGreaterThan(0);
  // Quiet frames.
  for (let frame = 0; frame < 5; frame++) settle();
  expect(audit.checks).toBeGreaterThan(afterFirst);
  // A grip: the held book's lever changes.
  shelf.setObjectGrip(first.entries[1].node, 60, 130); settle();
  expect(audit.entries[1].gripHeight).not.toBe(0);
  shelf.setObjectGrip(first.entries[1].node, 60, 250); settle();
  // A record with another thickness and another shelf's worth of height.
  shelf.updateEntry(first.entries[2].node, first.entries[2].book, { color:'#41694f', width:44 }); settle();
  // A new layout: other bays (one without a ceiling or edges), another width, one book fewer and the rest reordered.
  for (const entry of first.entries) entry.node.remove();
  const second = layout([{ top:30, bottom:240, left:12 }, { top:280, ceiling:270, bottom:470, right:400 }, { top:500, bottom:700 }], 420, [18, 28, 22]);
  second.entries[0].book = first.entries[3].book; second.entries[1].book = first.entries[0].book; second.entries[2].book = first.entries[1].book;
  for (const entry of second.entries) entry.node.dataset.bookId = entry.book.id;
  const before = audit.checks;
  expect(shelf.updateLayout(second)).toBe(true); settle(); settle();
  expect(audit.checks).toBeGreaterThan(before);
  shelf.setObjectGrip(second.entries[0].node, 60, 190); settle();
  expect(audit.misses).toEqual([]);
});
