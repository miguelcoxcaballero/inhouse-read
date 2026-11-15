// @vitest-environment node
// Microbench of buildMapsFromPixels: the build job of the shelf module (ReliefJob.build) against the frozen
// JavaScript generators that drove the same jobs one by one (tests/unit/helpers/reference-cover-relief-flow.js).
// Both sides run the same kernels in the same module, so what differs is the orchestration between the jobs.
// Interleaved rounds, medians of this process's CPU time. Not part of the suite. To run it:
//   cp tools/bench/relief-build-bench.test.js tests/unit/zz-relief-build-bench.test.js
//   npx vitest run tests/unit/zz-relief-build-bench.test.js && rm tests/unit/zz-relief-build-bench.test.js
import { it } from 'vitest';
import * as production from './helpers/relief-passes.js';
import * as frozen from './helpers/reference-cover-relief-flow.js';
import { makeColorMaskImage, colorMaskSelection } from '../helpers/color-mask-cases.mjs';

const drain = task => { for (;;) { const step = task.next(); if (step.done) return step.value; } };
const median = values => [...values].sort((a, b) => a - b)[values.length >> 1];
const cpu = () => { const { user, system } = process.cpuUsage(); return (user + system) / 1000; };

it('build job against the frozen generators', () => {
  const cases = [];
  // 8x8 leaves almost only the orchestration; the first case runs twice so that its first run is the warm-up.
  for (const [name, width, height, calls] of [['warm-up', 8, 8, 400], ['8x8', 8, 8, 400], ['64x96', 64, 96, 60], ['171x256', 171, 256, 12], ['341x512', 341, 512, 4]]) {
    const image = makeColorMaskImage({ width, height, kind: 'panels' }), work = makeColorMaskImage({ width: width >> 1, height: height >> 1, kind: 'panels' });
    cases.push([`${name} one colour`, work, image, colorMaskSelection(3).layers[2], calls * 3]);
    cases.push([`${name} three layers`, image, image, colorMaskSelection(3), calls]);
    cases.push([`${name} legacy`, work, image, { id: 'lettering', strength: .6 }, calls]);
  }
  for (const [name, work, hires, selection, calls] of cases) {
    const time = module => { const start = cpu(); for (let i = 0; i < calls; i++) drain(module.buildMapsFromPixels(work, hires, selection)); return (cpu() - start) / calls; };
    for (let warm = 0; warm < 3; warm++) { time(frozen); time(production); }
    const rust = [], js = [];
    for (let round = 0; round < 31; round++) { if (round & 1) { rust.push(time(production)); js.push(time(frozen)); } else { js.push(time(frozen)); rust.push(time(production)); } }
    console.log(`${name}: frozen ${median(js).toFixed(4)} ms, build job ${median(rust).toFixed(4)} ms (${((median(rust) / median(js) - 1) * 100).toFixed(1)} %)`);
  }
}, 600000);
