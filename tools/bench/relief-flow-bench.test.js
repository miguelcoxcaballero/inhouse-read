// @vitest-environment node
// Microbench of the cover relief's flows end to end (decode, rasters, every pass in the page's real slice driver,
// the planes): this tree against main, each with its own JavaScript and its own shelf module, side by side in
// one process over the same scripted canvas. What differs is who makes and steps the passes' jobs: main's
// generators (run, abortable and runSliced in src/js/cover-relief.js) or rust-ui/src/relief_flow.rs.
// Interleaved rounds, medians of this process's CPU time and, for a shared machine, the fastest round of each. Not part of the suite. To run it:
//   mkdir tests/unit/zz-base; cp -r <src/wasm/shelf of a build of main> tests/unit/zz-base/shelf
//   tests/unit/zz-base/cover-relief-main.js: main's src/js/cover-relief.js with its three imports aimed at
//     '../../../src/js/cover-appearance.js', './rust-shelf-base.js' and '../../../src/js/book-data-native.js'
//   tests/unit/zz-base/rust-shelf-base.js: initSync of that copy; needRustShelf, getRustShelf and loadRustShelf answer it
//   cp tools/bench/relief-flow-bench.test.js tests/unit/zz-relief-flow-bench.test.js
//   npx vitest run tests/unit/zz-relief-flow-bench.test.js; rm -r tests/unit/zz-relief-flow-bench.test.js tests/unit/zz-base
import { it, vi } from 'vitest';
import './helpers/rust-shelf-ready.js';
import * as production from '../../src/js/cover-relief.js';
import * as main from './zz-base/cover-relief-main.js';

const median = values => [...values].sort((a, b) => a - b)[values.length >> 1];
const cpu = () => { const { user, system } = process.cpuUsage(); return (user + system) / 1000; };

function browser(natural) {
  const canvas = () => {
    const context = { drawImage() {}, putImageData() {},
      getImageData(_x, _y, width, height) {
        const data = new Uint8ClampedArray(width * height * 4);
        for (let row = 0; row < height; row++) for (let column = 0; column < width; column++) {
          const at = (row * width + column) * 4, band = row * 3 < height ? [192, 32, 48] : row * 3 < height * 2 ? [24, 88, 192] : [240, 240, 240];
          const ink = column > width / 4 && column < width / 2 && row % 5 < 2 ? [20, 20, 20] : band;
          data[at] = ink[0]; data[at + 1] = ink[1]; data[at + 2] = ink[2]; data[at + 3] = column === 0 ? 0 : 255;
        }
        return { data };
      } };
    return { width:0, height:0, getContext:() => context, toDataURL:() => 'data:image/jpeg;x' };
  };
  vi.stubGlobal('document', { createElement:() => canvas() });
  vi.stubGlobal('Image', class { constructor() { this.naturalWidth = natural[0]; this.naturalHeight = natural[1]; } decode() { return Promise.resolve(); } });
  vi.stubGlobal('ImageData', class { constructor(data, width, height) { this.data = data; this.width = width; this.height = height; } });
}

const single = { id:'color-1', color:'#c02030', tolerance:6, strength:.75 };
const layered = { layers:[{ id:'color-1', color:'#c02030', tolerance:6, strength:.5 }, { id:'color-2', color:'#1858c0', tolerance:5, strength:1 }] };

it('relief flows against main', async () => {
  browser([384, 512]);
  const cases = [];
  for (const [name, maxSize, calls] of [['warm-up', 8, 60], ['8 px', 8, 60], ['64 px', 64, 30], ['256 px', 256, 6], ['512 px', 512, 3]]) {
    cases.push([`build ${name} one colour`, calls, module => module.buildReliefMaps('cover.jpg', single, { maxSize })]);
    cases.push([`build ${name} two layers, selection in alpha`, calls, module => module.buildReliefMaps('cover.jpg', layered, { maxSize, selectionAlpha:true })]);
  }
  cases.push(['analysis without previews', 6, module => module.analyzeCoverRelief('cover.jpg', { previews:false })]);
  cases.push(['analysis with previews', 6, module => module.analyzeCoverRelief('cover.jpg')]);
  for (const [name, calls, run] of cases) {
    const time = async module => { const start = cpu(); for (let i = 0; i < calls; i++) await run(module); return (cpu() - start) / calls; };
    for (let warm = 0; warm < 2; warm++) { await time(main); await time(production); }
    const now = [], before = [];
    for (let round = 0; round < 31; round++) {
      if (round & 1) { now.push(await time(production)); before.push(await time(main)); } else { before.push(await time(main)); now.push(await time(production)); }
    }
    const least = values => Math.min(...values);
    console.log(`${name}: main ${median(before).toFixed(4)} ms, this tree ${median(now).toFixed(4)} ms (${((median(now) / median(before) - 1) * 100).toFixed(1)} %); fastest round ${least(before).toFixed(4)} / ${least(now).toFixed(4)} ms (${((least(now) / least(before) - 1) * 100).toFixed(1)} %)`);
  }
  vi.unstubAllGlobals();
}, 1800000);
