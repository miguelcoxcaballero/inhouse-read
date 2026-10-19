// @vitest-environment node
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { beforeAll, expect, it } from 'vitest';
import { loadRustCore } from '../../src/js/rust-core.js';
import { rustBookPaperBuffers } from '../../src/js/page-mesh-wasm.js';
let core;
beforeAll(async () => { core = await loadRustCore({ bytes:readFileSync(new URL('../../src/wasm/inhouse_read_core.wasm', import.meta.url)) }); });
const bytes = array => Buffer.from(array.buffer, array.byteOffset, array.byteLength);
// Frozen original formulas, independent of Rust's batched mesh.
function reference(pasteWidth, pasteHeight, pageWidth, pageHeight, inset, overview) {
  const pasteGeometry = new THREE.PlaneGeometry(pasteWidth, pasteHeight, overview ? 3 : 10, 1);
  const pastePositions = pasteGeometry.getAttribute('position'), pasteShade = [];
  for (let i = 0; i < pastePositions.count; i++) {
    const fromJoint = (pasteWidth / 2 - pastePositions.getX(i)) / pasteWidth;
    const shade = 1 - .3 * Math.max(0, 1 - fromJoint / .14) ** 2 - .06 * Math.max(0, fromJoint - .88) / .12;
    pasteShade.push(shade, shade, shade);
  }
  pasteGeometry.setAttribute('color', new THREE.Float32BufferAttribute(pasteShade, 3));
  const paperGeometry = new THREE.PlaneGeometry(pageWidth + inset, pageHeight, 2, 1);
  const paperCorners = paperGeometry.getAttribute('position'), paperShade = [];
  for (let i = 0; i < paperCorners.count; i++) {
    if (Math.abs(paperCorners.getX(i)) < 1e-6) paperCorners.setX(i, -pageWidth / 2 + inset / 2);
    const shade = paperCorners.getX(i) < -pageWidth / 2 ? .74 : 1;
    paperShade.push(shade, shade, shade);
  }
  paperGeometry.setAttribute('color', new THREE.Float32BufferAttribute(paperShade, 3));
  return { pastedown:pasteGeometry, paper:paperGeometry };
}
function compare(params, api = core) {
  const result = rustBookPaperBuffers(api, ...params), expected = reference(...params);
  expect(result).not.toBeNull();
  for (const name of ['pastedown', 'paper']) {
    for (const [key, attribute] of [['positions', 'position'], ['normals', 'normal'], ['uvs', 'uv'], ['colors', 'color']]) {
      expect(bytes(result[name][key]), `${name} ${key}`).toEqual(bytes(expected[name].attributes[attribute].array));
    }
    expect(bytes(result[name].indices), `${name} indices`).toEqual(bytes(expected[name].index.array));
    expect(result[name].groups).toEqual(expected[name].groups);
    expected[name].dispose();
  }
  return result;
}
it('preserves both endpapers byte for byte across physical dimensions and overview/detail', () => {
  let seed = 0xabcde;
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < 180; i++) {
    const height = 1 + random() * 600, width = height * (.25 + random() * 1.8), inset = height * .009;
    compare([width - height * .028 - height * .004, height - height * .028 * 2,
      width - inset * 2, height - inset * 2, inset, i % 2 === 0]);
  }
  compare([132, 200, 132, 200, 0, false]);
  compare([.0000008, .0000009, .0000008, .0000009, 0, true]);
});
it('owns output storage, frees one arena, and reacquires grown WASM memory', () => {
  const allocations = [], releases = [];
  const wrapped = { ...core,
    alloc_f64(n) { const p = core.alloc_f64(n); allocations.push([p,n]); return p; },
    free_f64(p,n) { releases.push([p,n]); core.free_f64(p,n); },
    book_paper_planes(...args) { core.memory.grow(1); return core.book_paper_planes(...args); },
  };
  const result = compare([122, 190, 128, 196, 2, false], wrapped);
  const saved = Buffer.from(bytes(result.paper.positions));
  compare([240, 380, 256, 392, 4, true], wrapped); core.memory.grow(1);
  expect(bytes(result.paper.positions)).toEqual(saved);
  expect(result.paper.positions.buffer).not.toBe(core.memory.buffer);
  expect(allocations).toHaveLength(2); expect(releases).toEqual(allocations);
});
it('declines malformed dimensions and cleans up a failed kernel', () => {
  expect(rustBookPaperBuffers(null, 122, 190, 128, 196, 2)).toBeNull();
  for (const value of [0, -1, NaN, Infinity]) expect(rustBookPaperBuffers(core, value, 190, 128, 196, 2)).toBeNull();
  let freed = false;
  expect(rustBookPaperBuffers({ ...core, book_paper_planes() { throw new Error('trap'); },
    free_f64(p,n) { freed = true; core.free_f64(p,n); } }, 122,190,128,196,2)).toBeNull();
  expect(freed).toBe(true);
});
