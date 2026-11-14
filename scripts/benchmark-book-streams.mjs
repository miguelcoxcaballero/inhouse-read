// CPU-only timing of what a book paints from its pseudo-random stream: the spine (cloth, wear, burnish) and the
// whole model with its generated cloth case. Three builds of the same book, interleaved, medians:
//   frozen   tests/unit/helpers/reference-spine-surface.js and reference-book-model.js (the JavaScript originals)
//   previous a checkout of the version before (its src/js and built src/wasm), given as the first argument
//   current  this checkout
// Canvases are stand-ins whose methods do nothing: the numbers are the cost of deciding and issuing the canvas
// calls (and, for the model, of three's objects), not of rasterising. No renderer, no GPU.
// Run: npx vite-node scripts/benchmark-book-streams.mjs PREVIOUS_CHECKOUT [rounds] [part of a case's name]   (a directory inside this one, e.g. under
// test-results/, holding the previous version's src/js, tests/unit/helpers and built src/wasm)
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const previousRoot = process.argv[2], rounds = Number(process.argv[3]) || 41, only = process.argv[4] || '';
if (!previousRoot) throw new Error('Usage: npx vite-node scripts/benchmark-book-streams.mjs PREVIOUS_CHECKOUT [rounds]');

// ---- stand-ins: a document of canvases whose 2D context accepts every call a book makes ------------------
class Context {
  constructor(canvas) { this.canvas = canvas; this.font = '10px sans-serif'; this.fillStyle = '#000'; this.strokeStyle = '#000'; }
  save() {} restore() {} translate() {} rotate() {} scale() {} setTransform() {} reset() {}
  fillRect() {} strokeRect() {} clearRect() {} beginPath() {} closePath() {} arc() {} fill() {} stroke() {}
  moveTo() {} lineTo() {} quadraticCurveTo() {} bezierCurveTo() {} fillText() {} drawImage() {} putImageData() {}
  measureText(text) { return { width:String(text).length * 9.5 }; }
  createLinearGradient() { return { addColorStop() {} }; }
  createRadialGradient() { return { addColorStop() {} }; }
  createPattern() { return {}; }
  createImageData(width, height) { return { data:new Uint8ClampedArray(width * height * 4), width, height }; }
  getImageData(_x, _y, width, height) { return { data:new Uint8ClampedArray(width * height * 4), width, height }; }
}
class Canvas {
  constructor() { this.width = 300; this.height = 150; this.style = {}; this.context = null; }
  getContext() { return this.context ||= new Context(this); }
  addEventListener() {} removeEventListener() {}
}
globalThis.document = { createElement:tag => { if (tag !== 'canvas') throw new Error(`Unexpected <${tag}>`); return new Canvas(); } };
globalThis.devicePixelRatio = 2;

// ---- the three builds -----------------------------------------------------------------------------------
const coreBytes = root => readFileSync(resolve(root, 'src/wasm/inhouse_read_core.wasm'));
async function tree(root) {
  const at = file => pathToFileURL(resolve(root, file)).href;
  const shelfModule = await import(at('src/wasm/shelf/inhouse_read_shelf.js'));
  shelfModule.initSync({ module:readFileSync(resolve(root, 'src/wasm/shelf/inhouse_read_shelf_bg.wasm')) });
  // Each loader adopts the early instance the page head would have compiled.
  globalThis.__inhouseRustReady = WebAssembly.instantiate(coreBytes(root));
  const core = await (await import(at('src/js/rust-core.js'))).loadRustCore();
  if (!core) throw new Error(`The numeric core of ${root} did not load`);
  if (!await (await import(at('src/js/rust-shelf.js'))).loadRustShelf()) throw new Error(`The shelf module of ${root} did not load`);
  return { root, at, spine:await import(at('src/js/spine-surface.js')), model:await import(at('src/js/book-model.js')) };
}
const current = await tree('.'), previous = await tree(previousRoot);
const frozen = { spine:await import(current.at('tests/unit/helpers/reference-spine-surface.js')),
  model:await import(current.at('tests/unit/helpers/reference-book-model.js')) };

// ---- the books ------------------------------------------------------------------------------------------
const TITLES = ['Don Quijote de la Mancha', 'Cien años de soledad', 'The Quiet Garden', 'Crónica de una muerte anunciada', 'Ñandú', '東京物語',
  'La casa de los espíritus', 'A', 'Rayuela', 'Ficciones'];
const COLORS = ['#42604b', '#aa3355', '#112233', '#6b4a2f', '#2f4a6b'];
const book = i => ({ id:`book-${i}`, title:TITLES[i % TITLES.length], author:i % 3 ? 'Gabriel García Márquez' : undefined,
  spineEngraved:i % 4 === 0, spineFinish:i % 7 === 0 ? 'gold' : undefined, spineTextFinish:i % 5 === 0 ? 'gold' : undefined,
  coverFinish:['matte', 'satin', 'glossy'][i % 3], spineSurfaceFinish:['matte', 'satin', 'glossy'][(i + 1) % 3] });
const style = i => ({ color:COLORS[i % COLORS.length], ink:'#f4ead2', width:24 + (i % 5) * 6, fontFamily:'Playfair Display', fontWeight:700, coverRatio:.62 + (i % 4) * .03 });
const BOOKS = 20;

const flush = () => new Promise(done => setTimeout(done, 0));
// The box is shared: the process's own CPU time (user + system, in ms) is steadier than the wall clock there.
// `WALL=1` times with the wall clock instead.
const clock = process.env.WALL ? () => performance.now() : () => { const used = process.cpuUsage(); return (used.user + used.system) / 1000; };
function spines(module, options) {
  for (let i = 0; i < BOOKS; i++) {
    const surface = module.spineSurface(book(i), style(i), 200, 24 + (i % 5) * 6, options);
    module.releaseSurface(surface);
  }
}
function models(module, options) {
  for (let i = 0; i < BOOKS; i++) {
    const s = style(i);
    const model = module.createBookModel(book(i), s, 200 * s.coverRatio, 200, s.width, undefined, options);
    model.userData.dispose();
  }
}
const CASES = [
  ['spine, shelf (128 x 512)', build => spines(build.spine, { level:'shelf', textureWidth:128, textureHeight:512 })],
  ['spine, lifted (512 x 2048, woven)', build => spines(build.spine, { level:'detail', textureWidth:512, textureHeight:2048 })],
  ['spine, overview (thumbnail)', build => spines(build.spine, { level:'overview', textureWidth:32, textureHeight:128 })],
  ['book model, shelf, generated cloth case', build => models(build.model, { shelf:true })],
  ['book model, lifted, generated cloth case', build => models(build.model, {})],
  ['book model, overview', build => models(build.model, { shelf:true, overview:true })],
];
const BUILDS = [['frozen', frozen], ['previous', previous], ['current', current]];
const median = values => [...values].sort((a, b) => a - b)[values.length >> 1];
const report = [];
for (const [name, run] of CASES) {
  if (!name.includes(only)) continue;
  for (let warm = 0; warm < 6; warm++) for (const [, build] of BUILDS) { run(build); await flush(); }
  const times = { frozen:[], previous:[], current:[] };
  for (let round = 0; round < rounds; round++) {
    // Rotate the order so no build always runs first or last.
    for (let k = 0; k < BUILDS.length; k++) {
      const [label, build] = BUILDS[(k + round) % BUILDS.length];
      const start = clock();
      run(build);
      times[label].push((clock() - start) / BOOKS * 1000);
      await flush();
    }
  }
  const row = { case:name, microsecondsPerBook:Object.fromEntries(Object.entries(times).map(([label, values]) => [label, Number(median(values).toFixed(1))])) };
  row.currentOverFrozen = Number((row.microsecondsPerBook.current / row.microsecondsPerBook.frozen).toFixed(3));
  row.currentOverPrevious = Number((row.microsecondsPerBook.current / row.microsecondsPerBook.previous).toFixed(3));
  report.push(row);
  console.log(`${name}: frozen ${row.microsecondsPerBook.frozen} us, previous ${row.microsecondsPerBook.previous} us, current ${row.microsecondsPerBook.current} us per book`
    + ` (current/frozen ${row.currentOverFrozen}, current/previous ${row.currentOverPrevious})`);
}
console.log(JSON.stringify({ scope:'Node, stand-in canvases, interleaved rounds, medians. No rasterising, no GPU.', clock:process.env.WALL ? 'wall' : 'process CPU time', books:BOOKS, rounds, report }));
