// CPU-only timing of the book meshes: the frozen bridges to the numeric core (as book-model.js drove them)
// against the single calls of the shelf module (rust-ui/src/book_mesh.rs), each with the three.js install
// that follows it. Interleaved rounds, medians. No renderer, no GPU upload.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import * as THREE from 'three';
import * as shelf from '../src/wasm/shelf/inhouse_read_shelf.js';
import { rustBookPaperBuffers, rustLeafStackBuffers, rustPageBlockBuffers } from '../tests/unit/helpers/reference-page-mesh-wasm.js';
import { createBindingRelief, rustBindingBuffers } from '../tests/unit/helpers/reference-binding-wasm.js';
import { rustBookmarkBuffers } from '../tests/unit/helpers/reference-bookmark-wasm.js';
shelf.initSync({ module:readFileSync(new URL('../src/wasm/shelf/inhouse_read_shelf_bg.wasm', import.meta.url)) });
const core = (await WebAssembly.instantiate(readFileSync(new URL('../src/wasm/inhouse_read_core.wasm', import.meta.url)))).instance.exports;

// ---- The installs, as book-model.js had them and as it has them.
function paperMeshGeometry(buffers) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(buffers.positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(buffers.normals, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(buffers.uvs, 2));
  geometry.setAttribute('color', new THREE.BufferAttribute(buffers.colors, 3));
  geometry.setIndex(new THREE.BufferAttribute(buffers.indices, 1));
  for (const group of buffers.groups) geometry.addGroup(group.start, group.count, group.materialIndex);
  return geometry;
}
function frozenBinding(width, height, thickness, segments, relief, rows) {
  const buffers = rustBindingBuffers(core, width, height, thickness, segments, relief, rows);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(buffers.positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(buffers.normals, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(buffers.uvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(buffers.indices, 1));
  if (buffers.normalVersion) geometry.getAttribute('normal').needsUpdate = true;
  return geometry;
}
function meshGeometry(data, at = 0) {
  if (!data.length) return null;
  const vertices = data[at], count = data[at + 1], flags = data[at + 2], faces = data[at + 3], buffer = data.buffer;
  let byte = (at + 8) * 4;
  const floats = size => { const array = new Float32Array(buffer, byte, vertices * size); byte += array.byteLength; return new THREE.BufferAttribute(array, size); };
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', floats(3));
  geometry.setAttribute('normal', floats(3));
  geometry.setAttribute('uv', floats(2));
  if (flags & 2) geometry.setAttribute('color', floats(3));
  geometry.setIndex(new THREE.BufferAttribute(new (flags & 1 ? Uint32Array : Uint16Array)(buffer, byte, count), 1));
  if (flags & 8) { geometry.addGroup(0, faces, 0); if (faces < count) geometry.addGroup(faces, count - faces, 1); }
  if (flags & 4) geometry.getAttribute('normal').needsUpdate = true;
  return geometry;
}
let meshBuffer, meshNumbers, meshWords;
const meshMemory = shelf.book_mesh_memory(), ribbonViews = new Map();
function meshViews() {
  if (meshBuffer !== meshMemory.buffer) { meshBuffer = meshMemory.buffer; meshNumbers = new Float64Array(meshBuffer); meshWords = new Uint32Array(meshBuffer); ribbonViews.clear(); }
}
const meshMath = { resolve(requests, results, count) {
  meshViews();
  const numbers = meshNumbers, out = results >>> 3;
  for (let i = 0, at = requests >>> 3; i < count; i++, at += 3) {
    const a = numbers[at + 1];
    switch (numbers[at]) {
      case 0: numbers[out + i] = Math.sin(a); break;
      case 1: numbers[out + i] = Math.cos(a); break;
      case 2: numbers[out + i] = Math.pow(a, numbers[at + 2]); break;
      case 3: numbers[out + i] = Math.hypot(a, numbers[at + 2]); break;
      case 5: numbers[out + i] = Math.atan2(a, numbers[at + 2]); break;
      default: break;
    }
  }
} };
function ribbonBuffers(width, height, thickness, progress, peek, open, withdraw, segments, seed, legacy) {
  const at = shelf.book_mesh_ribbon(meshMath, width, height, thickness, progress, peek, open, withdraw, segments, seed, Boolean(legacy)) >>> 2;
  if (!at) return null;
  meshViews();
  const words = meshWords, count = words[at];
  let views = ribbonViews.get(count);
  if (!views) ribbonViews.set(count, views = { positions:new Float32Array(meshBuffer, words[at + 1], count * 12),
    uvs:new Float32Array(meshBuffer, words[at + 2], count * 8), normals:new Float32Array(meshBuffer, words[at + 3], count * 12),
    indices:new Uint16Array(meshBuffer, words[at + 4], words[at + 5]) });
  return views;
}
function fly(pixels, target) {
  const reuse = target?.getAttribute('position')?.count === pixels.positions.length / 3
    && target.getAttribute('uv')?.count === pixels.uvs.length / 2 && target.index?.count === pixels.indices.length;
  const geometry = reuse ? target : new THREE.BufferGeometry();
  if (reuse) {
    geometry.getAttribute('position').array.set(pixels.positions);
    geometry.getAttribute('uv').array.set(pixels.uvs);
    geometry.getAttribute('position').needsUpdate = true;
    geometry.getAttribute('uv').needsUpdate = true;
    geometry.boundingBox = geometry.boundingSphere = null;
  } else {
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(pixels.positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(pixels.uvs, 2));
    geometry.setIndex(new THREE.Uint16BufferAttribute(pixels.indices, 1));
  }
  const normal = geometry.getAttribute('normal');
  if (normal?.count === pixels.normals.length / 3) normal.array.set(pixels.normals);
  else geometry.setAttribute('normal', new THREE.Float32BufferAttribute(pixels.normals, 3));
  geometry.getAttribute('normal').needsUpdate = true;
  return geometry;
}

const pixels = new Uint8ClampedArray(256 * 1024 * 4);
for (let i = 3, seed = 99; i < pixels.length; i += 4) pixels[i] = (seed = Math.imul(seed, 1664525) + 1013904223 >>> 0) >>> 24;
const frozenSample = createBindingRelief(core, pixels);
const sample = Object.assign((u, v) => pixels[shelf.book_mesh_relief_index(u, v, 256, 1024)] / 255, { pixels });
const bytes = array => Buffer.from(array.buffer, array.byteOffset, array.byteLength);
const sameGeometry = (a, b) => { for (const name of Object.keys(b.attributes)) assert.deepEqual(bytes(a.getAttribute(name).array), bytes(b.getAttribute(name).array));
  assert.deepEqual(bytes(a.index.array), bytes(b.index.array)); };

let frozenRibbon = { 8:null, 32:null }, madeRibbon = { 8:null, 32:null };
const pose = i => [(i % 97) / 96, (i % 13) / 12 * .4];
const cases = {
  // One shelf book: endpapers, page block and plain binding (the shelf model's own sizes and segment counts).
  'shelf book (endpapers + block + binding 24)':[
    () => { const paper = rustBookPaperBuffers(core, 120, 188, 128, 196, 1.8, false); paper.pastedown.groups = paper.paper.groups = [];
      return [paperMeshGeometry(paper.pastedown), paperMeshGeometry(paper.paper), paperMeshGeometry(rustPageBlockBuffers(core, 132, 200, 40, {})), frozenBinding(132, 200, 40, 24, null, 384)]; },
    () => { const paper = shelf.book_mesh_paper_planes(120, 188, 128, 196, 1.8, false);
      return [meshGeometry(paper), meshGeometry(paper, paper[7]), meshGeometry(shelf.book_mesh_page_block(meshMath, 132, 200, 40, 200 * .007, 200 * .009, false)),
        meshGeometry(shelf.book_mesh_binding(meshMath, 132, 200, 40, 24, null, 384))]; }],
  'lifted book (endpapers + detailed block + leaves + binding 96)':[
    () => { const paper = rustBookPaperBuffers(core, 240, 376, 256, 392, 3.6, false); paper.pastedown.groups = paper.paper.groups = [];
      return [paperMeshGeometry(paper.pastedown), paperMeshGeometry(paper.paper), paperMeshGeometry(rustPageBlockBuffers(core, 264, 400, 80, { detail:true })),
        paperMeshGeometry(rustLeafStackBuffers(core, 264, 400, 30, {})), frozenBinding(264, 400, 80, 96, null, 384)]; },
    () => { const paper = shelf.book_mesh_paper_planes(240, 376, 256, 392, 3.6, false);
      return [meshGeometry(paper), meshGeometry(paper, paper[7]), meshGeometry(shelf.book_mesh_page_block(meshMath, 264, 400, 80, 400 * .007, 400 * .009, true)),
        meshGeometry(shelf.book_mesh_leaf_stack(meshMath, 264, 400, 30, 400 * .007, 400 * .009, 14)), meshGeometry(shelf.book_mesh_binding(meshMath, 264, 400, 80, 96, null, 384))]; }],
  'page block alone':[() => [paperMeshGeometry(rustPageBlockBuffers(core, 132, 200, 40, {}))],
    () => [meshGeometry(shelf.book_mesh_page_block(meshMath, 132, 200, 40, 200 * .007, 200 * .009, false))]],
  'binding 96 plain':[() => [frozenBinding(264, 400, 80, 96, null, 384)], () => [meshGeometry(shelf.book_mesh_binding(meshMath, 264, 400, 80, 96, null, 384))]],
  'binding 96 x 384 with raster relief':[() => [frozenBinding(264, 400, 80, 96, frozenSample, 384)], () => [meshGeometry(shelf.book_mesh_binding(meshMath, 264, 400, 80, 96, sample, 384))]],
  'ribbon frame, 32 segments (reused buffers)':[
    i => [frozenRibbon[32] = fly(rustBookmarkBuffers(core, 264, 400, 80, .45, 16, ...pose(i), 32, 12345, false), frozenRibbon[32])],
    i => [madeRibbon[32] = fly(ribbonBuffers(264, 400, 80, .45, 16, ...pose(i), 32, 12345, false), madeRibbon[32])]],
  'ribbon frame, 8 segments (reused buffers)':[
    i => [frozenRibbon[8] = fly(rustBookmarkBuffers(core, 132, 200, 40, .45, 10, ...pose(i), 8, 7, false), frozenRibbon[8])],
    i => [madeRibbon[8] = fly(ribbonBuffers(132, 200, 40, .45, 10, ...pose(i), 8, 7, false), madeRibbon[8])]],
  'ribbon built new, 32 segments':[
    i => [fly(rustBookmarkBuffers(core, 264, 400, 80, .45, 16, ...pose(i), 32, 12345, false))],
    i => [fly(ribbonBuffers(264, 400, 80, .45, 16, ...pose(i), 32, 12345, false))]],
};
const median = list => list.sort((a, b) => a - b)[list.length >> 1];
const rounds = Number(process.argv[2]) || 41;
for (const [name, [frozen, made]] of Object.entries(cases)) {
  const heavy = name.includes('raster'), batch = heavy ? 10 : 400;
  for (let i = 0; i < 5; i++) { const a = frozen(i), b = made(i); a.forEach((geometry, at) => sameGeometry(b[at], geometry)); }
  for (let i = 0; i < batch * 3; i++) { frozen(i); made(i); }
  const times = { frozen:[], made:[] };
  for (let round = 0; round < rounds; round++) for (const [key, run] of round & 1 ? [['made', made], ['frozen', frozen]] : [['frozen', frozen], ['made', made]]) {
    const start = performance.now();
    for (let i = 0; i < batch; i++) run(i);
    times[key].push((performance.now() - start) / batch * 1000);
  }
  const before = median(times.frozen), after = median(times.made);
  console.log(JSON.stringify({ case:name, unit:'microseconds', frozen:+before.toFixed(3), shelf:+after.toFixed(3), ratio:+(after / before).toFixed(3) }));
}
