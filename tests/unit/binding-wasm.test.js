// @vitest-environment node
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadRustCore } from '../../src/js/rust-core.js';
import { rustBindingBuffers } from '../../src/js/binding-wasm.js';
import { bindingGeometry } from '../../src/js/book-model.js';
import { referenceBindingGeometry } from './helpers/reference-binding-geometry.js';

let core;
beforeAll(async () => {
  core = await loadRustCore({ bytes:readFileSync(new URL('../../src/wasm/inhouse_read_core.wasm', import.meta.url)) });
  expect(typeof core?.binding_mesh).toBe('function');
});
const bytes = array => Buffer.from(array.buffer, array.byteOffset, array.byteLength);
const patterns = [null, () => 0, () => 1,
  (u, v) => u > .4 && u < .6 && v > .4 && v < .6 ? 1 : 0,
  (u, v) => Math.round((Math.sin(u * 27) * Math.cos(v * 41) + 1) * 127.5) / 255];
const fixtures = [
  [132, 200, 40, 12, 12], [264, 400, 80, 96, 384],
  [62.125, 92.375, 8.25, 8, 24], [400, 240, 120, 96, 80],
  [93, 180, 17, 1, 1], [132, 200, 40, 255, 255],
];
function compare(buffers, reference) {
  for (const [array, name] of [[buffers.positions, 'position'], [buffers.normals, 'normal'], [buffers.uvs, 'uv']]) {
    expect(Buffer.compare(bytes(array), bytes(reference.attributes[name].array)), `${name} bytes`).toBe(0);
  }
  expect(buffers.indices.constructor).toBe(reference.index.array.constructor);
  expect(Buffer.compare(bytes(buffers.indices), bytes(reference.index.array)), 'topology bytes').toBe(0);
}
describe('compiled curved binding keeps the exact original surface', () => {
  for (const fixture of fixtures) it(`preserves every vertex, normal, UV and index at ${fixture.join('/')}`, () => {
    const [width, height, thickness, segments, rows] = fixture;
    for (const relief of patterns) {
      const reference = referenceBindingGeometry(width, height, thickness, segments, relief, rows);
      try {
        const buffers = rustBindingBuffers(core, width, height, thickness, segments, relief, rows);
        expect(buffers).not.toBeNull(); compare(buffers, reference);
      } finally { reference.dispose(); }
    }
  });
  it('routes actual book geometry through Rust while preserving attribute versions and groups', () => {
    for (const relief of [null, patterns[3]]) {
      const actual = bindingGeometry(200, 300, 52, 96, relief, 384);
      const reference = referenceBindingGeometry(200, 300, 52, 96, relief, 384);
      try {
        compare({ positions:actual.attributes.position.array, normals:actual.attributes.normal.array,
          uvs:actual.attributes.uv.array, indices:actual.index.array }, reference);
        for (const name of ['position', 'normal', 'uv']) {
          expect(actual.attributes[name].version).toBe(reference.attributes[name].version);
          expect(actual.attributes[name].itemSize).toBe(reference.attributes[name].itemSize);
          expect(actual.attributes[name].normalized).toBe(reference.attributes[name].normalized);
        }
        expect(actual.groups).toEqual(reference.groups);
        expect(actual.boundingBox).toBeNull(); expect(actual.boundingSphere).toBeNull();
      } finally { actual.dispose(); reference.dispose(); }
    }
  });
  it('samples relief once in the same column-first order and at identical coordinates', () => {
    const original = [], actual = [];
    const reference = referenceBindingGeometry(132, 200, 40, 12, (u, v) => { original.push([u, v]); return u * v; }, 17);
    const buffers = rustBindingBuffers(core, 132, 200, 40, 12, (u, v) => { actual.push([u, v]); return u * v; }, 17);
    expect(actual).toEqual(original); compare(buffers, reference); reference.dispose();
  });
  it('frees all scratch storage after success and leaves owned buffers independent of later operations', () => {
    const allocations = [], releases = [];
    const tracked = { ...core,
      alloc_f64(length) { const pointer = core.alloc_f64(length); allocations.push([pointer, length]); return pointer; },
      free_f64(pointer, length) { releases.push([pointer, length]); core.free_f64(pointer, length); },
    };
    const first = rustBindingBuffers(tracked, 132, 200, 40, 96, patterns[3], 384);
    const snapshot = Buffer.from(bytes(first.positions));
    rustBindingBuffers(tracked, 264, 400, 80, 96, patterns[4], 384);
    core.memory.grow(1);
    expect(bytes(first.positions)).toEqual(snapshot);
    expect(first.positions.buffer).not.toBe(core.memory.buffer);
    expect(releases).toEqual(allocations);
  });
  it('survives recursive kernels and WASM growth during a relief sample', () => {
    let sampled = false;
    const buffers = rustBindingBuffers(core, 132, 200, 40, 12, (u, v) => {
      if (!sampled) {
        sampled = true; core.memory.grow(1);
        const nested = rustBindingBuffers(core, 264, 400, 80, 96, patterns[4], 384);
        expect(nested.positions.length).toBe(97 * 385 * 3);
      }
      return u * v;
    }, 17);
    const reference = referenceBindingGeometry(132, 200, 40, 12, (u, v) => u * v, 17);
    compare(buffers, reference); reference.dispose();
  });
  it('releases the arena and propagates an exceptional relief sample without calling it twice', () => {
    const releases = [], allocations = [], failure = new Error('sample failed'); let count = 0;
    const tracked = { ...core,
      alloc_f64(length) { const pointer = core.alloc_f64(length); allocations.push([pointer, length]); return pointer; },
      free_f64(pointer, length) { releases.push([pointer, length]); core.free_f64(pointer, length); },
    };
    expect(() => rustBindingBuffers(tracked, 132, 200, 40, 96, () => { count++; throw failure; }, 384)).toThrow(failure);
    expect(count).toBe(1); expect(releases).toEqual(allocations);
  });
  it('leaves unsupported geometry and unavailable allocation to the original implementation', () => {
    expect(rustBindingBuffers(null, 132, 200, 40)).toBeNull();
    for (const args of [[0, 200, 40], [132, 200, NaN], [132, 200, 40, 2.5],
      [132, 200, 40, 1024], [132, 200, 40, 512, () => 0, 1024]]) {
      expect(rustBindingBuffers(core, ...args)).toBeNull();
    }
    expect(rustBindingBuffers({ ...core, alloc_f64:() => 0 }, 132, 200, 40)).toBeNull();
    let sampled = false;
    expect(rustBindingBuffers({ ...core, alloc_f64:() => { throw new RangeError('WASM memory exhausted'); } },
      132, 200, 40, 96, () => { sampled = true; return 0; })).toBeNull();
    expect(sampled).toBe(false);
  });
});
