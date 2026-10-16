// CPU binding geometry, including the actual host bridge and Three install.
// Usage: node scripts/benchmark-binding-core.mjs [output.json]
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { cpus } from 'node:os';
import { performance } from 'node:perf_hooks';
import * as THREE from 'three';
import { rustBindingBuffers } from '../src/js/binding-wasm.js';
import { referenceBindingGeometry } from '../tests/unit/helpers/reference-binding-geometry.js';

const WARMUPS = 5, BATCHES = 15;
const fixtures = [
  { name:'detail-plain', width:264, height:400, thickness:80, segments:96, rows:384, pattern:'none', repetitions:64 },
  { name:'shelf-plain', width:132, height:200, thickness:40, segments:32, rows:96, pattern:'none', repetitions:128 },
  { name:'overview-plain', width:132, height:200, thickness:40, segments:16, rows:384, pattern:'none', repetitions:128 },
  { name:'twelve-segment-compatibility', width:62.125, height:92.375, thickness:8.25, segments:12, rows:12, pattern:'none', repetitions:128 },
  { name:'shelf-engraved', width:132, height:200, thickness:40, segments:32, rows:96, pattern:'mask', repetitions:4 },
  { name:'detail-engraved', width:264, height:400, thickness:80, segments:96, rows:384, pattern:'mask', repetitions:1 },
  { name:'detail-smooth-relief', width:400, height:240, thickness:120, segments:96, rows:384, pattern:'wave', repetitions:1 },
  { name:'uint32-index-boundary', width:132, height:200, thickness:40, segments:255, rows:255, pattern:'mask', repetitions:1 },
];
const mask = Uint8Array.from({ length:64 * 256 }, (_, index) => {
  const x = index % 64, y = Math.floor(index / 64);
  return x > 9 && x < 54 && y > 18 && y < 238 && ((Math.floor(y / 11) + Math.floor(x / 7)) % 3) ? 255 : 0;
});
const patterns = {
  none:null,
  mask:(u, v) => mask[Math.min(255, Math.floor(v * 256)) * 64 + Math.min(63, Math.floor(u * 64))] / 255,
  wave:(u, v) => Math.round((Math.sin(u * 27) * Math.cos(v * 41) + 1) * 127.5) / 255,
};
const argsFor = fixture => [fixture.width, fixture.height, fixture.thickness, fixture.segments, patterns[fixture.pattern], fixture.rows];
const bytes = await readFile(new URL('../src/wasm/inhouse_read_core.wasm', import.meta.url));
const started = performance.now();
const { instance } = await WebAssembly.instantiate(bytes);
const initializationMs = performance.now() - started, core = instance.exports;
assert.equal(core.core_abi_version(), 1);
assert.equal(typeof core.binding_mesh, 'function', 'The real compiled binding export is required');
const initialMemoryBytes = core.memory.buffer.byteLength;

// Mirrors the production bindingGeometry installation exactly. The adapter
// allocates, samples callbacks, copies all output arrays and frees scratch.
// BufferAttribute takes those owned arrays without an additional copy.
function rustGeometry(fixture, exports = core) {
  const buffers = rustBindingBuffers(exports, ...argsFor(fixture));
  if (!buffers) throw new Error('The direct Rust bridge fell back: ' + fixture.name);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(buffers.positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(buffers.normals, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(buffers.uvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(buffers.indices, 1));
  if (buffers.normalVersion) geometry.getAttribute('normal').needsUpdate = true;
  return geometry;
}
const jsGeometry = fixture => referenceBindingGeometry(...argsFor(fixture));
const arrayBytes = array => Buffer.from(array.buffer, array.byteOffset, array.byteLength);
const fields = geometry => ({ ...geometry.attributes, index:geometry.index });
function exactGeometry(actual, expected) {
  for (const name of ['position', 'normal', 'uv', 'index']) {
    const a = fields(actual)[name], e = fields(expected)[name];
    assert.equal(a.array.constructor, e.array.constructor, name + ' array type');
    assert.equal(Buffer.compare(arrayBytes(a.array), arrayBytes(e.array)), 0, name + ' exact bytes');
    assert.deepEqual([a.itemSize, a.normalized, a.version], [e.itemSize, e.normalized, e.version], name + ' attribute contract');
  }
  assert.deepEqual(actual.groups, expected.groups);
  assert.equal(actual.boundingBox, expected.boundingBox);
  assert.equal(actual.boundingSphere, expected.boundingSphere);
}
const hashes = geometry => Object.fromEntries(Object.entries(fields(geometry)).map(([name, attribute]) =>
  [name, createHash('sha256').update(arrayBytes(attribute.array)).digest('hex')]));
function parity(fixture) {
  const expected = jsGeometry(fixture), actual = rustGeometry(fixture);
  try {
    exactGeometry(actual, expected);
    return { hashes:hashes(actual), outputBytes:Object.values(fields(actual)).reduce((sum, attribute) => sum + attribute.array.byteLength, 0),
      vertices:actual.attributes.position.count, indices:actual.index.count, indexType:actual.index.array.constructor.name };
  } finally { actual.dispose(); expected.dispose(); }
}
function run(build, fixture) {
  let checksum = 0;
  for (let index = 0; index < fixture.repetitions; index++) {
    const geometry = build(fixture);
    try {
      checksum += geometry.attributes.position.array[1] + geometry.attributes.normal.array[2]
        + geometry.attributes.uv.array[3] + geometry.index.array[geometry.index.count - 1];
    } finally { geometry.dispose(); }
  }
  return checksum;
}
const statistics = values => {
  const sorted = [...values].sort((a, b) => a - b);
  return { samples:values, medianMs:sorted[Math.floor(sorted.length / 2)], p95Ms:sorted[Math.ceil(sorted.length * .95) - 1],
    totalMs:values.reduce((sum, value) => sum + value, 0) };
};
const firstStarted = performance.now(), first = rustGeometry(fixtures[0]);
const firstGeometryMs = performance.now() - firstStarted; first.dispose();
const measurements = [];
for (const fixture of fixtures) {
  const before = parity(fixture), expected = run(jsGeometry, fixture);
  for (let warm = 0; warm < WARMUPS; warm++) {
    assert.equal(run(jsGeometry, fixture), expected);
    assert.equal(run(rustGeometry, fixture), expected);
  }
  const samples = { javascript:[], rust:[] }, orders = [];
  for (let round = 0; round < BATCHES; round++) {
    const order = round % 2 ? ['rust', 'javascript'] : ['javascript', 'rust']; orders.push(order);
    for (const engine of order) {
      const start = performance.now(), checksum = run(engine === 'rust' ? rustGeometry : jsGeometry, fixture);
      samples[engine].push(performance.now() - start);
      assert.equal(checksum, expected); // Outside the measured interval.
    }
  }
  assert.deepEqual(parity(fixture), before);
  const javascript = statistics(samples.javascript), rust = statistics(samples.rust);
  measurements.push({ fixture, exactParity:true, ...before, orders, javascript, rust,
    javascriptPerGeometryMedianMs:javascript.medianMs / fixture.repetitions,
    rustPerGeometryMedianMs:rust.medianMs / fixture.repetitions });
}

// Actual allocator instrumentation runs after all timings, never substituting
// a Rust operation. This bridge must retain no WASM allocation between calls.
let live = 0, peak = 0, allocations = 0, releases = 0, kernelCalls = 0;
const tracked = { ...core,
  alloc_f64(length) { const pointer = core.alloc_f64(length); if (pointer) { live += length * 8; peak = Math.max(peak, live); allocations++; } return pointer; },
  free_f64(pointer, length) { core.free_f64(pointer, length); live -= length * 8; releases++; },
  binding_finish(...args) { kernelCalls++; return core.binding_finish(...args); },
};
const memoryCases = fixtures.map(fixture => {
  const geometry = rustGeometry(fixture, tracked); geometry.dispose();
  assert.equal(live, 0, fixture.name + ' retained an arena');
  return { name:fixture.name, liveArenaBytesAfterDisposal:live };
});
assert.equal(kernelCalls, fixtures.length); assert.equal(allocations, releases);
const report = {
  benchmark:'binding-rust-vs-original', generatedAt:new Date().toISOString(),
  environment:{ node:process.version, platform:process.platform, arch:process.arch, cpu:cpus()[0]?.model },
  scope:'Desktop Node CPU geometry construction and Three BufferGeometry installation. No renderer, GPU, phone, battery, temperature or whole-app speed is measured.',
  artifact:{ bytes:bytes.length, sha256:createHash('sha256').update(bytes).digest('hex') },
  methodology:{ warmupBatchesPerEngine:WARMUPS, measuredBatchesPerEngine:BATCHES,
    includes:'Allocation/free, original host trigonometry, relief input callbacks, every JS/WASM crossing, all owned output copies, Three attributes/index installation and disposal. No timing pass threshold. All positions, normals, UVs and index bytes/contracts checked before and after timing.',
    patterns:'Deterministic binary 64x256 embossed-text-like mask and quantized smooth trigonometric surface; no lowered resolution. Current shelf uses32 segments, overview16, detail96;12 is an additional compatibility case.' },
  initialization:{ compileAndInstantiateMs:initializationMs, firstGeometryMs }, measurements,
  memory:{ initialWasmCapacityBytes:initialMemoryBytes, finalWasmCapacityBytes:core.memory.buffer.byteLength,
    peakLiveArenaBytes:peak, liveArenaBytesAfterDisposal:live, allocations, releases, actualKernelCalls:kernelCalls, cases:memoryCases },
};
const json = JSON.stringify(report, null, 2) + '\n';
if (process.argv[2]) { const destination = resolve(process.argv[2]); await mkdir(dirname(destination), { recursive:true }); await writeFile(destination, json); }
process.stdout.write(json);
