// Desktop numeric clustering only. Includes row sampling, arena allocation,
// copying, the actual kernel, rounding and free. No phone/frame-rate claim.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { cpus } from 'node:os';
import { rustDominantCoverRgb } from '../src/js/cover-color-wasm.js';
import { referenceDominantRgb } from '../tests/unit/helpers/reference-cover-color.js';
import { coverColorCases, createCoverColorPixels } from '../tests/helpers/cover-color-cases.mjs';

const bytes = await readFile(new URL('../src/wasm/inhouse_read_core.wasm', import.meta.url));
const started = performance.now(), { instance } = await WebAssembly.instantiate(bytes), core = instance.exports;
const initializationMs = performance.now() - started;
assert.equal(typeof core.cover_dominant_rgb, 'function');
const hash = data => createHash('sha256').update(data).digest('hex');
const repetitions = 32, warmups = 4, rounds = 15;
const median = values => [...values].sort((a,b) => a - b)[Math.floor(values.length / 2)];
const measurements = [];
for (const input of coverColorCases) {
  const data = createCoverColorPixels(input), expected = referenceDominantRgb(data, input.width, input.height);
  const js = () => referenceDominantRgb(data, input.width, input.height);
  const rust = () => rustDominantCoverRgb(core, data, input.width, input.height);
  assert.deepEqual(rust(), expected);
  const run = build => { let checksum = 0; for (let i = 0; i < repetitions; i++) {
    const rgb = build(); checksum += rgb[0] + rgb[1] * 256 + rgb[2] * 65536;
  } return checksum; };
  const checksum = run(js), samples = { javascript:[], rust:[] }, orders = [];
  for (let i = 0; i < warmups; i++) { assert.equal(run(js), checksum); assert.equal(run(rust), checksum); }
  for (let round = 0; round < rounds; round++) {
    const order = round % 2 ? ['rust', 'javascript'] : ['javascript', 'rust']; orders.push(order);
    for (const kind of order) {
      const start = performance.now(), actual = run(kind === 'rust' ? rust : js);
      samples[kind].push(performance.now() - start); assert.equal(actual, checksum);
    }
  }
  assert.deepEqual(rust(), expected);
  measurements.push({ input, execution:input.kind === 'alpha' ? 'host-empty-sample' : 'rust', inputSha256:hash(data), rgb:expected, samples, orders,
    javascriptPerCoverMedianMs:median(samples.javascript) / repetitions,
    rustPerCoverMedianMs:median(samples.rust) / repetitions });
}
let live = 0, peak = 0, allocations = 0, releases = 0, calls = 0;
const tracked = { ...core,
  alloc_f64(length) { const pointer = core.alloc_f64(length); if (pointer) { live += length * 8; peak = Math.max(peak, live); allocations++; } return pointer; },
  free_f64(pointer, length) { core.free_f64(pointer, length); live -= length * 8; releases++; },
  cover_dominant_rgb(...args) { calls++; return core.cover_dominant_rgb(...args); },
};
for (const input of coverColorCases) {
  const data = createCoverColorPixels(input);
  const before = { calls, allocations, releases };
  assert.deepEqual(rustDominantCoverRgb(tracked, data, input.width, input.height), referenceDominantRgb(data, input.width, input.height));
  assert.equal(live, 0);
  const required = input.kind === 'alpha' ? 0 : 1;
  assert.equal(calls - before.calls, required);
  assert.equal(allocations - before.allocations, required);
  assert.equal(releases - before.releases, required);
}
assert.equal(calls, coverColorCases.length - 1); assert.equal(allocations, releases);
const report = { generatedAt:new Date().toISOString(), artifact:{ bytes:bytes.length, sha256:hash(bytes) }, initializationMs,
  environment:{ node:process.version, platform:process.platform, cpu:cpus()[0]?.model },
  scope:'Desktop numeric clustering including row sampling, all copies, allocation/free, actual kernel and rounding. The explicitly marked empty sampled-alpha case bypasses Rust and allocation. Synthetic deterministic RGBA; no image decoding, canvas, GPU or physical phone timing.',
  methodology:{ repetitions, warmups, rounds, alternating:true }, measurements,
  memory:{ liveArenaBytes:live, peakLiveArenaBytes:peak, allocations, releases, actualKernelCalls:calls, wasmCapacityBytes:core.memory.buffer.byteLength } };
const json = JSON.stringify(report, null, 2) + '\n';
if (process.argv[2]) await writeFile(process.argv[2], json);
process.stdout.write(json);
