// The arena half of a placement job: a frozen copy of the bridge with its core against today's bridge with its
// core, the same jobs, interleaved rounds, medians. Usage:
//   node scripts/benchmark-shelf-placement-arena.mjs <frozen bridge .mjs> <frozen core .wasm>
// Every job's answer is compared with the frozen one before anything is timed.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createShelfPlacementSession, placeObjects } from '../src/js/shelf-placement-wasm.js';
import { generatePlacement } from '../tests/helpers/shelf-placement-cases.mjs';

const [frozenPath, frozenWasm] = process.argv.slice(2);
if (!frozenPath || !frozenWasm) throw new Error('usage: <frozen bridge .mjs> <frozen core .wasm>');
const frozen = await import(pathToFileURL(frozenPath).href);
const load = async bytes => (await WebAssembly.instantiate(bytes)).instance.exports;
const before = { api:frozen, core:await load(await readFile(frozenWasm)) };
const now = { api:{ createShelfPlacementSession, placeObjects },
  core:await load(await readFile(new URL('../src/wasm/inhouse_read_core.wasm', import.meta.url))) };
const median = values => [...values].sort((a, b) => a - b)[values.length >> 1];
const rounds = 41;

for (const count of [16, 40, 300]) {
  const input = generatePlacement(count * 7 + 3, count);
  const options = { ...input.options, physicalPlacement:false };
  const keys = input.objects.map(object => object.key);
  const targets = Array.from({ length:64 }, (_, n) => ({ key:keys[(n * 5) % keys.length], shelf:n % 5, x:((n * 37) % 101) / 100 }));
  const jobs = {
    'session move': side => {
      const session = side.api.createShelfPlacementSession(input.objects, options);
      assert.ok(session);
      return { run:target => session.move(side.core, target.key, target.shelf, target.x), end:() => session.dispose() };
    },
    'layout': side => ({ run:() => side.api.placeObjects(side.core, input.objects, options), end() {} }),
    'move': side => ({ run:target => side.api.placeObjects(side.core, input.objects, options,
      { move:true, movedKey:target.key, target }), end() {} }),
  };
  for (const [name, make] of Object.entries(jobs)) {
    const a = make(before), b = make(now);
    for (const target of targets) assert.deepEqual(b.run(target), a.run(target));
    const repeat = count >= 300 ? 4 : 16, samples = { before:[], now:[] };
    const time = job => { const start = performance.now(); for (let n = 0; n < repeat; n++) for (const target of targets) job.run(target);
      return (performance.now() - start) * 1000 / (repeat * targets.length); };
    for (let n = 0; n < 6; n++) { time(a); time(b); }
    for (let round = 0; round < rounds; round++) {
      if (round % 2) { samples.now.push(time(b)); samples.before.push(time(a)); }
      else { samples.before.push(time(a)); samples.now.push(time(b)); }
    }
    a.end(); b.end();
    console.log(`${String(count).padStart(4)} objects  ${name.padEnd(12)}  frozen ${median(samples.before).toFixed(2)} us   now ${median(samples.now).toFixed(2)} us`);
  }
}
