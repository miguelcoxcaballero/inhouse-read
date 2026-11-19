// A book's motion: the frozen bridge to the numeric core (tests/unit/helpers/reference-book-motion-bridge.js)
// against the shelf module's own sampler (rust-ui/src/book_sampler.rs). CPU only: no three, no draw.
//   npx vite-node scripts/benchmark-book-motion-sampler.mjs [directory of a shelf module built before the change]
// With that directory, the frames of a motion are also timed as a view runs them: the earlier module's
// book_view_motion_tick calling the bridge through the host, against this one's sampling in place.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import * as shelf from '../src/wasm/shelf/inhouse_read_shelf.js';
import { loadRustCore } from '../src/js/rust-core.js';
import { motionPose } from '../src/js/book-view-wasm.js';
import * as bridge from '../tests/unit/helpers/reference-book-motion-bridge.js';

shelf.initSync({ module:readFileSync(new URL('../src/wasm/shelf/inhouse_read_shelf_bg.wasm', import.meta.url)) });
await loadRustCore({ bytes:readFileSync(new URL('../src/wasm/inhouse_read_core.wasm', import.meta.url)) });
let earlier = null;
if (process.argv[2]) {
  const directory = resolve(process.argv[2]);
  earlier = await import(pathToFileURL(resolve(directory, 'inhouse_read_shelf.js')).href);
  earlier.initSync({ module:readFileSync(resolve(directory, 'inhouse_read_shelf_bg.wasm')) });
}

const pose = { x:2, y:4, scale:1, angle:9, pitch:0, roll:0, coverOpen:0, bookmarkWithdraw:0, pageTheme:1 };
const keyframes = count => Array.from({ length:count }, (_, i) => ({ offset:i / (count - 1),
  transform:{ ...pose, x:70 * i, angle:32 - i, coverOpen:i / (count - 1), pageTheme:i % 2 } }));
const median = values => [...values].sort((a, b) => a - b)[values.length >> 1];
const ROUNDS = 41;
function compare(label, unit, calls, frozen, production) {
  const times = { frozen:[], production:[] };
  for (let round = 0; round < ROUNDS; round++) for (const kind of round % 2 ? ['production', 'frozen'] : ['frozen', 'production']) {
    const run = kind === 'frozen' ? frozen : production, start = performance.now();
    run(calls); times[kind].push((performance.now() - start) * 1e6 / calls);
  }
  const a = median(times.frozen), b = median(times.production);
  console.log(`${label.padEnd(46)} ${a.toFixed(0).padStart(7)} -> ${b.toFixed(0).padStart(7)} ${unit}  (${(b / a).toFixed(2)}x)`);
}

const host = { pose:motionPose };
let sink = 0;
for (const count of [2, 4, 16]) {
  const frames = keyframes(count);
  const frozen = bridge.createBookMotionSampler(frames), id = shelf.book_sampler_open(frames);
  frozen.start(1e9, 0); shelf.book_sampler_start(id, 1e9, 0);
  compare(`frame: clock step + pose, ${count} keyframes`, 'ns', 20000,
    calls => { for (let i = 0; i < calls; i++) { const t = frozen.step(i * 16); sink += frozen.sample(t === 1 ? i % 101 / 100 : t).x; } },
    calls => { for (let i = 0; i < calls; i++) { const t = shelf.book_sampler_step(id, i * 16); sink += shelf.book_sampler_pose(id, t === 1 ? i % 101 / 100 : t, host).x; } });
  compare(`pose alone, ${count} keyframes`, 'ns', 20000,
    calls => { for (let i = 0; i < calls; i++) sink += frozen.sample(i % 101 / 100).x; },
    calls => { for (let i = 0; i < calls; i++) sink += shelf.book_sampler_pose(id, i % 101 / 100, host).x; });
  frozen.dispose(); shelf.book_sampler_close(id);
  compare(`open + close a motion, ${count} keyframes`, 'ns', 2000,
    calls => { for (let i = 0; i < calls; i++) bridge.createBookMotionSampler(frames).dispose(); },
    calls => { for (let i = 0; i < calls; i++) shelf.book_sampler_close(shelf.book_sampler_open(frames)); });
}

if (earlier) {
  // One frame of a view's motion, scheduler included: the callback requestAnimationFrame runs.
  let next, raf = 0;
  globalThis.requestAnimationFrame = callback => { next = callback; return ++raf; };
  globalThis.cancelAnimationFrame = () => {};
  const options = { direct:false };
  const motion = (module, frames) => {
    const state = module.book_view_motion_state({ createSampler:bridge.createBookMotionSampler, pose:motionPose,
      draw(value) { sink += value.x; }, noop() {}, position() {}, measure() {},
      tick:module.book_view_motion_tick, cancel:module.book_view_motion_cancel, release:module.book_view_motion_release });
    const animation = module.book_view_motion_start(state, frames, 1e12, null, null, options), tick = next;
    return { tick, end() { animation.cancel(); module.book_view_motion_dispose(state); } };
  };
  for (const count of [2, 4, 16]) {
    const frames = keyframes(count), before = motion(earlier, frames), after = motion(shelf, frames);
    compare(`a view's frame (tick, clock, pose, draw), ${count} keyframes`, 'ns', 20000,
      calls => { for (let i = 0; i < calls; i++) before.tick(); }, calls => { for (let i = 0; i < calls; i++) after.tick(); });
    before.end(); after.end();
    const eligible = { direct:true, compact:true, adaptive:true, ratio:2, width:360, height:780 };
    const start = module => calls => { for (let i = 0; i < calls; i++) {
      const state = module.book_view_motion_state({ createSampler:bridge.createBookMotionSampler, pose:motionPose, draw() {}, noop() {}, position() {},
        measure:value => ({ width:100 + value.x, height:200 }),
        tick:module.book_view_motion_tick, cancel:module.book_view_motion_cancel, release:module.book_view_motion_release });
      module.book_view_motion_start(state, frames, 500, null, pose, eligible).cancel(); module.book_view_motion_dispose(state);
    } };
    compare(`start a measured motion (17 probes) and cancel, ${count} keyframes`, 'ns', 500, start(earlier), start(shelf));
  }
}
if (!Number.isFinite(sink)) console.log('sink', sink);
