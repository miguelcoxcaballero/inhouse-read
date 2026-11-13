// CPU-only timing of a view's arithmetic: the frozen bridge to the numeric core (an arena of the core, views
// made per call) against the same kernels inside the shelf module (one cached view). Interleaved rounds,
// medians; every answer is first compared. Run from the repository root. No renderer, no DOM.
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import './../tests/unit/helpers/rust-core-ready.js';
import './../tests/unit/helpers/rust-shelf-ready.js';
import * as frozen from '../tests/unit/helpers/reference-book-view-wasm.js';
import * as made from '../src/js/book-view-wasm.js';

const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const camera = { matrixWorldInverse:{ elements:[1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -195, -422, -1200, 1] },
  projectionMatrix:{ elements:[2 / 390, 0, 0, 0, 0, 2 / 844, 0, 0, 0, 0, -2 / 2399, 0, 0, 0, -2401 / 2399, 1] } };
const box = { min:{ x:-66, y:-100, z:-20 }, max:{ x:66, y:100, z:20 }, matrix:identity };
const pose = i => ({ x:120 + i % 50, y:300 + i % 70, angle:(i % 90) / 90, pitch:.1, roll:0, scale:1 + (i % 10) / 20, coverOpen:(i % 40) / 39, bookmarkWithdraw:0 });
const frameInput = i => ({ compact:true, direct:true, adaptive:true, measureOnly:false, scale:1, ratio:2, viewportWidth:390, viewportHeight:844, coverOpen:(i % 40) / 39,
  closedWidth:192, openWidth:576, height:448, motion:{ width:0, height:0 }, native:{ width:64, height:64 } });
const cases = {
  'pose': api => i => api.planBookPose(pose(i), undefined, 195, 422, 390, 844, 1),
  'return frame (measured bounds)': api => i => api.planReturnFrame(frameInput(i), () => api.boxScreenBounds([box], camera, 390, 844)),
  'copy rectangle': api => i => api.planCopyRectangle({ viewportWidth:390, viewportHeight:844, ratio:2, canvasWidth:780, canvasHeight:1688,
    frame:{ x:20 + i % 9, y:40, width:300, height:500 }, scale:1 }, () => api.boxScreenBounds([box], camera, 390, 844)),
  'frame aligned': api => i => api.frameAligned(390, 844, 2, 20 + i % 9, 40, 300, 500),
  'board bounds (3 boxes)': api => i => api.boxScreenBounds([box, box, box], camera, 390, 844, { left:i % 5, top:3 }),
  'page bounds': api => i => api.planPageBounds(128, 196, 390, 844, { left:i % 5, top:3 }, identity, camera),
  'one frame of a flight (pose + return frame + copy + aligned)': api => i => [api.planBookPose(pose(i), undefined, 195, 422, 390, 844, 1),
    api.planReturnFrame(frameInput(i), () => api.boxScreenBounds([box], camera, 390, 844)),
    api.planCopyRectangle({ viewportWidth:390, viewportHeight:844, ratio:2, canvasWidth:780, canvasHeight:1688, frame:{ x:20 + i % 9, y:40, width:300, height:500 }, scale:1 },
      () => api.boxScreenBounds([box], camera, 390, 844)), api.frameAligned(390, 844, 2, 20 + i % 9, 40, 300, 500)],
  'view sizes (per view)': api => i => api.planBookView({ shelf:i & 1, devicePixelRatio:2, innerWidth:390, viewportWidth:390, viewportHeight:844, width:132, height:200, thickness:40 }),
  'cover fit (per cover)': api => i => api.fitImage(600 + i % 7, 900, 512, 768),
};
const median = list => list.sort((a, b) => a - b)[list.length >> 1];
const rounds = Number(process.argv[2]) || 41, batch = 4000;
for (const [name, build] of Object.entries(cases)) {
  const before = build(frozen), after = build(made);
  for (let i = 0; i < 300; i++) assert.deepStrictEqual(after(i), before(i), name);
  for (let i = 0; i < batch * 3; i++) { before(i); after(i); }
  const times = { before:[], after:[] };
  for (let round = 0; round < rounds; round++) for (const [key, run] of round & 1 ? [['after', after], ['before', before]] : [['before', before], ['after', after]]) {
    const start = performance.now();
    for (let i = 0; i < batch; i++) run(i);
    times[key].push((performance.now() - start) / batch * 1e6);
  }
  const a = median(times.before), b = median(times.after);
  console.log(JSON.stringify({ case:name, unit:'nanoseconds', frozen:Math.round(a), shelf:Math.round(b), ratio:+(b / a).toFixed(3) }));
}
