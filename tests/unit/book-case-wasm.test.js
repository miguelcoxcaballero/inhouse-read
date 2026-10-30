// The case of a book model (both boards and both ends of the binding) comes from the shelf module
// (rust-ui/src/book_case.rs). Compared byte for byte with the frozen JavaScript it replaced
// (helpers/reference-book-case.js): every attribute, the attribute order, the index and its type, the
// groups and the geometry type, over random sizes and every detail level.
import * as THREE from 'three';
import { afterEach, expect, it, vi } from 'vitest';
import { boardGeometry, createBookModel } from '../../src/js/book-model.js';
import { referenceBoardGeometry, referenceCapGeometry, referenceFrontBoard } from './helpers/reference-book-case.js';

function random(seed) { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }
const bytes = array => Buffer.from(array.buffer, array.byteOffset, array.byteLength);

function expectSameGeometry(actual, expected, label) {
  expect(actual.type, `${label} type`).toBe(expected.type);
  expect(Object.keys(actual.attributes), `${label} attribute order`).toEqual(Object.keys(expected.attributes));
  for (const name of Object.keys(expected.attributes)) {
    const left = actual.attributes[name], right = expected.attributes[name];
    expect(left.itemSize, `${label} ${name} size`).toBe(right.itemSize);
    expect(left.normalized, `${label} ${name} normalized`).toBe(right.normalized);
    expect(left.array.constructor, `${label} ${name} type`).toBe(right.array.constructor);
    expect(left.array.length, `${label} ${name} length`).toBe(right.array.length);
    if (!bytes(left.array).equals(bytes(right.array))) {
      for (let i = 0; i < left.array.length; i++) {
        if (!Object.is(left.array[i], right.array[i])) throw new Error(`${label} ${name}[${i}] ${left.array[i]} / ${right.array[i]}`);
      }
    }
  }
  if (expected.index) {
    expect(actual.index?.array.constructor, `${label} index type`).toBe(expected.index.array.constructor);
    expect(bytes(actual.index.array).equals(bytes(expected.index.array)), `${label} index`).toBe(true);
  } else expect(actual.index, `${label} no index`).toBeNull();
  expect(actual.groups, `${label} groups`).toEqual(expected.groups);
  expect(actual.boundingBox, `${label} bounds`).toBeNull();
  expect(actual.drawRange, `${label} draw range`).toEqual(expected.drawRange);
}

afterEach(() => vi.restoreAllMocks());

it('builds every board like the original ExtrudeGeometry, its translation and its cover UVs', () => {
  const r = random(41);
  const levels = [{}, { shelf:true }, { overview:true }, { shelf:true, overview:true }];
  for (let trial = 0; trial < 600; trial++) {
    const height = trial % 9 === 0 ? 1 + r() * 20 : 60 + r() * 900, width = height * (.2 + r() * 2.2);
    const depth = trial % 5 === 0 ? r() * 40 + .01 : height * .007;
    const options = levels[trial % levels.length];
    const actual = boardGeometry(width, height, depth, options), expected = referenceBoardGeometry(width, height, depth, options);
    expectSameGeometry(actual, expected, `board ${trial} ${width}x${height}x${depth} ${JSON.stringify(options)}`);
  }
  for (const [width, height, depth] of [[132, 200, 1.4], [200, 300, 2.1], [264, 400, 2.8], [1, 1, 1], [1e-3, 2e-3, 1e-4], [5000, 9000, 63]]) {
    for (const options of levels) expectSameGeometry(boardGeometry(width, height, depth, options),
      referenceBoardGeometry(width, height, depth, options), `board ${width}x${height}x${depth}`);
  }
});

it('rejects sizes no board can have instead of building a broken mesh', () => {
  for (const size of [[0, 200, 1], [-1, 200, 1], [NaN, 200, 1], [100, Infinity, 1], [100, 200, 0]]) {
    expect(() => boardGeometry(...size), String(size)).toThrow(RangeError);
  }
});

function canvasContext() {
  const context = new Proxy({
    measureText: text => ({ width:String(text).length * 16 }),
    createLinearGradient: () => ({ addColorStop() {} }),
    getImageData: (_x, _y, width, height) => ({ data:new Uint8ClampedArray(width * height * 4) })
  }, { get: (target, key) => target[key] ?? (() => {}) });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context);
}

it('gives every model the original front board groups, back board and both binding ends', () => {
  canvasContext();
  const r = random(42);
  const levels = [{ shelf:true }, { shelf:true, overview:true }, {}, { shelf:true, inspectionResolution:1024 }];
  for (let trial = 0; trial < 48; trial++) {
    const height = 80 + r() * 500, width = Math.round(height * (.45 + r() * .5)), thickness = 6 + r() * 70;
    const options = levels[trial % levels.length];
    const book = { id:`case:${trial}`, title:`Case ${trial}`, author:'A', format:'EPUB' };
    const style = { color:'#42604b', shade:'#324c3a', ink:'#ffffff', coverRatio:.66, width:thickness };
    const model = createBookModel(book, style, width, height, thickness, null, options);
    const board = height * .007, shelf = Boolean(options.shelf), overview = Boolean(options.overview);
    const segments = overview ? 16 : shelf ? 32 : 96, rim = overview ? 0 : board * 1.1;
    const label = `${trial} ${width}x${height}x${thickness} ${JSON.stringify(options)}`;
    expectSameGeometry(model.getObjectByName('front-cover').geometry, referenceFrontBoard(width, height, board, { shelf, overview }), `front ${label}`);
    expectSameGeometry(model.getObjectByName('back-cover').geometry, referenceBoardGeometry(width, height, board, { shelf, overview }), `back ${label}`);
    const tail = model.getObjectByName('binding-tail-cap').geometry, head = model.getObjectByName('binding-head-cap').geometry;
    expect(tail).not.toBe(head);
    expect(tail.attributes.position.array).not.toBe(head.attributes.position.array);
    for (const [name, geometry] of [['tail', tail], ['head', head]]) {
      expectSameGeometry(geometry, referenceCapGeometry(width, thickness, segments, rim), `${name} cap ${label}`);
    }
    expect(model.getObjectByName('front-cover').geometry.attributes.position.array)
      .not.toBe(model.getObjectByName('back-cover').geometry.attributes.position.array);
    model.userData.dispose();
  }
});

it('splits the front board where its lid normals turn inwards, as many times as they do', () => {
  canvasContext();
  const model = createBookModel({ id:'split', title:'Split' }, { color:'#42604b', ink:'#fff', coverRatio:.66, width:30 }, 132, 200, 30, null, {});
  const groups = model.getObjectByName('front-cover').geometry.groups;
  expect(groups.map(group => group.materialIndex)).toEqual(referenceFrontBoard(132, 200, 1.4).groups.map(group => group.materialIndex));
  expect(new Set(groups.map(group => group.materialIndex))).toEqual(new Set([0, 1, 2]));
  model.userData.dispose();
  expect(THREE.REVISION).toBe('180');
});
