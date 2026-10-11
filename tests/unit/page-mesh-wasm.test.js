// @vitest-environment node
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadRustCore } from '../../src/js/rust-core.js';
import { rustPageBlockBuffers, rustLeafStackBuffers } from '../../src/js/page-mesh-wasm.js';
import { referencePageBlockGeometry, referenceLeafStackGeometry } from './helpers/reference-page-mesh.js';
import { paperMeshCases } from '../helpers/page-mesh-cases.mjs';

let core;
beforeAll(async () => {
  core = await loadRustCore({ bytes:readFileSync(new URL('../../src/wasm/inhouse_read_core.wasm', import.meta.url)) });
  expect(typeof core?.page_block_mesh).toBe('function');
  expect(typeof core?.leaf_stack_mesh).toBe('function');
});
const bytes = array => Buffer.from(array.buffer, array.byteOffset, array.byteLength);
const attributes = [['positions', 'position', 3], ['normals', 'normal', 3], ['uvs', 'uv', 2], ['colors', 'color', 3]];
const adapter = kind => kind === 'block' ? rustPageBlockBuffers : rustLeafStackBuffers;
const frozen = kind => kind === 'block' ? referencePageBlockGeometry : referenceLeafStackGeometry;
function compare(buffers, reference) {
  expect(buffers).not.toBeNull();
  const actual = new THREE.BufferGeometry();
  try {
    for (const [key, name, itemSize] of attributes) {
      const original = reference.attributes[name];
      expect(buffers[key].constructor, name).toBe(original.array.constructor);
      expect(Buffer.compare(bytes(buffers[key]), bytes(original.array)), `${name} bytes`).toBe(0);
      actual.setAttribute(name, new THREE.BufferAttribute(buffers[key], itemSize));
      expect(actual.attributes[name].version).toBe(original.version);
      expect(actual.attributes[name].itemSize).toBe(original.itemSize);
      expect(actual.attributes[name].normalized).toBe(original.normalized);
    }
    expect(buffers.indices.constructor).toBe(reference.index.array.constructor);
    expect(Buffer.compare(bytes(buffers.indices), bytes(reference.index.array)), 'topology bytes').toBe(0);
    expect(buffers.groups).toEqual(reference.groups);
    actual.setIndex(new THREE.BufferAttribute(buffers.indices, 1));
    for (const group of buffers.groups) actual.addGroup(group.start, group.count, group.materialIndex);
    expect(actual.boundingBox).toBeNull(); expect(actual.boundingSphere).toBeNull();
    actual.computeBoundingBox(); actual.computeBoundingSphere();
    reference.computeBoundingBox(); reference.computeBoundingSphere();
    expect(actual.boundingBox).toEqual(reference.boundingBox);
    expect(actual.boundingSphere).toEqual(reference.boundingSphere);
  } finally { actual.dispose(); }
}
function compareCase(kind, width, height, depth, options) {
  const reference = frozen(kind)(width, height, depth, options);
  try { compare(adapter(kind)(core, width, height, depth, options), reference); }
  finally { reference.dispose(); }
}

describe('actual compiled Rust preserves the page mesh byte for byte', () => {
  for (const fixture of paperMeshCases) it(`matches the frozen ${fixture.name} mesh`, () => {
    compareCase(fixture.kind, fixture.width, fixture.height, fixture.depth, fixture.options);
  });
  it('retains page block subdivisions with default, zero and custom board/inset widths', () => {
    for (const detail of [false, true]) for (const [width, height, thickness, options] of [
      [132, 200, 4, {}], [400, 240, 220, { board:0, inset:0 }],
      [85.3125, 193.617, 7.995, { board:.17123, inset:.69217 }],
      [1.32, 2, .4, { board:0, inset:0 }],
    ]) compareCase('block', width, height, thickness, { ...options, detail });
  });
  it('retains leaf topology, zero depth and signed zero normals at each supported resolution', () => {
    for (const columns of [1, 2, 8, 14, 31, 512]) for (const depth of [0, -0, .001, 52.125]) {
      compareCase('leaves', 132.731, 213.489, depth, { board:0, inset:0, columns });
    }
  });
  it('keeps f64 operation order across a deterministic physical dimension corpus', () => {
    let state = 0x1f3497a2;
    const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
    for (let i = 0; i < 120; i++) {
      const height = 65 + random() * 520, width = height * (.32 + random() * 1.9);
      const board = height * (.002 + random() * .013), inset = height * random() * .025;
      const thickness = board * 2.4 + .001 + random() * height * .5;
      compareCase('block', width, height, thickness, { board, inset, detail:i % 2 === 0 });
      compareCase('leaves', width, height, random() * thickness, { board, inset, columns:1 + Math.floor(random() * 40) });
    }
  });
  it('owns every output buffer, frees each arena and keeps earlier results unchanged', () => {
    const allocations = [], releases = [];
    const tracked = { ...core,
      alloc_f64(length) { const pointer = core.alloc_f64(length); allocations.push([pointer, length]); return pointer; },
      free_f64(pointer, length) { releases.push([pointer, length]); core.free_f64(pointer, length); },
    };
    const block = rustPageBlockBuffers(tracked, 132, 200, 40, { detail:true });
    const leaf = rustLeafStackBuffers(tracked, 132, 200, 20);
    const snapshots = [block, leaf].map(result => Object.fromEntries([...attributes.map(([key]) => key), 'indices']
      .map(key => [key, Buffer.from(bytes(result[key]))])));
    for (let i = 0; i < 25; i++) {
      rustPageBlockBuffers(tracked, 80 + i, 180, 10 + i);
      rustLeafStackBuffers(tracked, 80 + i, 180, i, { columns:31 });
    }
    core.memory.grow(1);
    for (const [i, result] of [block, leaf].entries()) for (const key of Object.keys(snapshots[i])) {
      expect(result[key].buffer).not.toBe(core.memory.buffer);
      expect(bytes(result[key])).toEqual(snapshots[i][key]);
    }
    expect(new Set(Object.keys(snapshots[0]).map(key => block[key].buffer)).size).toBe(5);
    expect(releases).toEqual(allocations);
  });
  it('reacquires memory after a kernel grows it and supports independent nested operations', () => {
    let nested = false;
    const wrapped = { ...core, page_block_mesh(...args) {
      if (!nested) {
        nested = true;
        const inside = rustLeafStackBuffers(core, 264, 400, 37, { columns:31 });
        expect(inside.positions.length).toBe((6 * 32 + 4) * 3);
        core.memory.grow(1);
      }
      core.page_block_mesh(...args);
    } };
    const reference = referencePageBlockGeometry(132, 200, 40, { detail:true });
    try { compare(rustPageBlockBuffers(wrapped, 132, 200, 40, { detail:true }), reference); }
    finally { reference.dispose(); }
  });
  it('leaves unavailable kernels, invalid dimensions and exhausted allocation to the original mesh', () => {
    for (const run of [rustPageBlockBuffers, rustLeafStackBuffers]) {
      expect(run(null, 132, 200, 40)).toBeNull();
      expect(run({ ...core, page_block_mesh:null, leaf_stack_mesh:null }, 132, 200, 40)).toBeNull();
      for (const dims of [[0, 200, 40], [132, NaN, 40], [132, 200, Infinity], [132, 200, -1]]) {
        expect(run(core, ...dims)).toBeNull();
      }
      for (const options of [{ board:NaN }, { board:-1 }, { inset:-1 }, { inset:1000 }]) {
        expect(run(core, 132, 200, 40, options)).toBeNull();
      }
      expect(run({ ...core, alloc_f64:() => 0 }, 132, 200, 40)).toBeNull();
      expect(run({ ...core, alloc_f64:() => { throw new RangeError('exhausted'); } }, 132, 200, 40)).toBeNull();
    }
    expect(rustPageBlockBuffers(core, 132, 200, 0)).toBeNull();
    expect(rustPageBlockBuffers(core, 132, 200, 2)).toBeNull();
    for (const columns of [0, -1, 1.5, 513, NaN]) expect(rustLeafStackBuffers(core, 132, 200, 40, { columns })).toBeNull();
  });
  it('frees scratch after exceptional pure kernels before returning the original-path signal', () => {
    for (const [run, name] of [[rustPageBlockBuffers, 'page_block_mesh'], [rustLeafStackBuffers, 'leaf_stack_mesh']]) {
      const allocations = [], releases = [];
      const tracked = { ...core,
        alloc_f64(length) { const pointer = core.alloc_f64(length); allocations.push([pointer, length]); return pointer; },
        free_f64(pointer, length) { releases.push([pointer, length]); core.free_f64(pointer, length); },
        [name]() { throw new WebAssembly.RuntimeError('kernel trap'); },
      };
      expect(run(tracked, 132, 200, 40)).toBeNull();
      expect(allocations).toHaveLength(1); expect(releases).toEqual(allocations);
    }
  });
});
