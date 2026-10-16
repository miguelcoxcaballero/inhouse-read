// Arithmetic/owned arrays/Three installation only. Never a phone/frame-rate claim.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { cpus } from 'node:os';
import * as THREE from 'three';
import { rustPageBlockBuffers, rustLeafStackBuffers } from '../src/js/page-mesh-wasm.js';
import { referencePageBlockGeometry, referenceLeafStackGeometry } from '../tests/unit/helpers/reference-page-mesh.js';
import { paperMeshCases } from '../tests/helpers/page-mesh-cases.mjs';

const bytes = await readFile(new URL('../src/wasm/inhouse_read_core.wasm', import.meta.url));
const started = performance.now(), { instance } = await WebAssembly.instantiate(bytes), core = instance.exports;
const initializationMs = performance.now() - started;
assert.equal(typeof core.page_block_mesh, 'function'); assert.equal(typeof core.leaf_stack_mesh, 'function');
const args = input => [input.width, input.height, input.depth, input.options];
const original = input => (input.kind === 'block' ? referencePageBlockGeometry : referenceLeafStackGeometry)(...args(input));
const rust = (input, engine = core) => {
  const buffers = (input.kind === 'block' ? rustPageBlockBuffers : rustLeafStackBuffers)(engine, ...args(input));
  assert.ok(buffers, 'Direct Rust bridge must not fall back');
  const geometry = new THREE.BufferGeometry();
  for (const [name, array, size] of [['position', buffers.positions, 3], ['normal', buffers.normals, 3],
    ['uv', buffers.uvs, 2], ['color', buffers.colors, 3]]) geometry.setAttribute(name, new THREE.BufferAttribute(array, size));
  geometry.setIndex(new THREE.BufferAttribute(buffers.indices, 1));
  for (const group of buffers.groups) geometry.addGroup(group.start, group.count, group.materialIndex);
  return geometry;
};
const hash = array => createHash('sha256').update(new Uint8Array(array.buffer, array.byteOffset, array.byteLength)).digest('hex');
const descriptor = geometry => ({ groups:geometry.groups,
  fields:Object.fromEntries(Object.entries({ ...geometry.attributes, index:geometry.index }).map(([name, field]) => [name,
    { bytes:field.array.byteLength, type:field.array.constructor.name, size:field.itemSize, version:field.version,
      normalized:field.normalized, sha256:hash(field.array) }])) });
const parity = input => {
  const expected = original(input), actual = rust(input);
  try { const result = descriptor(expected); assert.deepEqual(descriptor(actual), result); return result; }
  finally { expected.dispose(); actual.dispose(); }
};
const repetitions = 128, warmups = 5, rounds = 15;
const run = (build, input) => {
  let checksum = 0;
  for (let i = 0; i < repetitions; i++) {
    const geometry = build(input);
    checksum += geometry.attributes.position.array[0] + geometry.attributes.normal.array[1]
      + geometry.index.array[geometry.index.count - 1];
    geometry.dispose();
  }
  return checksum;
};
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const measurements = [];
for (const input of paperMeshCases) {
  const before = parity(input), checksum = run(original, input), samples = { javascript:[], rust:[] }, orders = [];
  for (let i = 0; i < warmups; i++) { assert.equal(run(original, input), checksum); assert.equal(run(rust, input), checksum); }
  for (let round = 0; round < rounds; round++) {
    const order = round % 2 ? ['rust', 'javascript'] : ['javascript', 'rust']; orders.push(order);
    for (const kind of order) {
      const start = performance.now(), actual = run(kind === 'rust' ? rust : original, input);
      samples[kind].push(performance.now() - start); assert.equal(actual, checksum);
    }
  }
  assert.deepEqual(parity(input), before);
  measurements.push({ input, parity:before, orders, samples,
    javascriptPerGeometryMedianMs:median(samples.javascript) / repetitions,
    rustPerGeometryMedianMs:median(samples.rust) / repetitions });
}
let live = 0, peak = 0, allocations = 0, releases = 0, calls = 0;
const tracked = { ...core,
  alloc_f64(length) { const pointer = core.alloc_f64(length); if (pointer) { live += length * 8; peak = Math.max(peak, live); allocations++; } return pointer; },
  free_f64(pointer, length) { core.free_f64(pointer, length); live -= length * 8; releases++; },
  page_block_finish(...args) { calls++; return core.page_block_finish(...args); },
  leaf_stack_finish(...args) { calls++; return core.leaf_stack_finish(...args); },
};
for (const input of paperMeshCases) { rust(input, tracked).dispose(); assert.equal(live, 0); }
assert.equal(calls, paperMeshCases.length); assert.equal(allocations, releases);
const report = { generatedAt:new Date().toISOString(), artifact:{ bytes:bytes.length, sha256:hash(bytes) }, initializationMs,
  environment:{ node:process.version, platform:process.platform, cpu:cpus()[0]?.model },
  scope:'Desktop CPU geometry construction including input coefficients, allocation/free, all copies and Three attributes/groups. No rendering or physical phone measurements.',
  methodology:{ repetitions, warmups, rounds, alternating:true }, measurements,
  memory:{ liveArenaBytes:live, peakLiveArenaBytes:peak, allocations, releases, actualKernelCalls:calls, wasmCapacityBytes:core.memory.buffer.byteLength } };
const json = JSON.stringify(report, null, 2) + '\n';
if (process.argv[2]) await writeFile(process.argv[2], json);
process.stdout.write(json);
