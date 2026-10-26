// Drive tools/bench/book-model.html in headless Chromium (SwiftShader) against a running `npx vite`:
//   node tools/bench/run-book-model-bench.mjs <port> [--cpu 4] [--books 60] [--rounds 5] [--profile] [--motion]
// Prints JSON lines: creation time of shelf models (sync part of createBookModel), and the CPU cost
// of bookView.draw during one opening (with and without the GPU draw itself).
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const port = Number(args[0] || 4471);
const flag = (name, fallback) => { const at = args.indexOf(`--${name}`); return at < 0 ? fallback : Number(args[at + 1]); };
const cpu = flag('cpu', 1), books = flag('books', 60), rounds = flag('rounds', 5);
const profile = args.includes('--profile'), motion = args.includes('--motion'), creation = !args.includes('--no-creation');
const browser = await chromium.launch({
  executablePath: process.env.BENCH_CHROME || '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
});
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
page.on('pageerror', error => console.error('pageerror', error.message));
await page.goto(`http://127.0.0.1:${port}/inhouse-read/tools/bench/book-model.html`);
await page.evaluate(() => window.benchReady.then(() => true));
const cdp = await page.context().newCDPSession(page);
await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });

const median = values => { const s = [...values].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

async function createRound(count) {
  return page.evaluate(async count => {
    const { model } = await window.benchReady;
    const list = window.benchBooks(count), made = [];
    const start = performance.now();
    for (const entry of list) made.push(model.createBookModel(entry.book, entry.style, entry.width, entry.height,
      entry.thickness, null, { shelf: true }));
    const elapsed = performance.now() - start;
    for (const group of made) group.userData.dispose();
    await new Promise(resolve => setTimeout(resolve, 50));
    return elapsed;
  }, count);
}

if (creation) {
  await createRound(4); // warm module code paths, shared textures and the JIT
  const times = [];
  for (let r = 0; r < rounds; r++) times.push(await createRound(books));
  console.log(JSON.stringify({ bench: 'createBookModel(shelf)', cpu, books, roundsMs: times.map(t => +t.toFixed(1)),
    medianMs: +median(times).toFixed(1), perBookMs: +(median(times) / books).toFixed(3) }));
}

if (args.includes('--parts')) {
  const parts = await page.evaluate(async count => {
    const { THREE, spine, needRustShelf } = await window.benchReady;
    const list = window.benchBooks(count), out = {};
    const time = (name, run) => { const start = performance.now(); run(); out[name] = +(performance.now() - start).toFixed(1); };
    for (let warm = 0; warm < 2; warm++) {
      const surfaces = [];
      time('spineSurface', () => { for (const e of list) surfaces.push(spine.spineSurface(e.book, e.style, e.height, e.thickness,
        needRustShelf().book_spine_options(e.height, true, false, 0, 1))); });
      for (const s of surfaces) spine.releaseSurface(s);
      time('materials', () => { for (let i = 0; i < count * 10; i++) new THREE.MeshPhysicalMaterial({ color:'#123456' }); });
      time('extrude', () => { for (const e of list) for (let k = 0; k < 2; k++) {
        const shape = new THREE.Shape(), x = -e.width / 2, y = -e.height / 2, w = e.width, h = e.height, r = e.height * .006;
        shape.moveTo(x + r, y); shape.lineTo(x + w - r, y); shape.quadraticCurveTo(x + w, y, x + w, y + r);
        shape.lineTo(x + w, y + h - r); shape.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
        shape.lineTo(x + r, y + h); shape.quadraticCurveTo(x, y + h, x, y + h - r);
        shape.lineTo(x, y + r); shape.quadraticCurveTo(x, y, x + r, y);
        new THREE.ExtrudeGeometry(shape, { depth:1, bevelEnabled:true, bevelThickness:.5, bevelSize:.5, bevelSegments:1, steps:1, curveSegments:2 });
      } });
    }
    return out;
  }, books);
  console.log(JSON.stringify({ bench: 'parts', cpu, books, ...parts }));
}

const motionProfile = args.includes('--motion-profile');
async function motionRun(frames) {
  return page.evaluate(async frames => {
    const { model } = await window.benchReady;
    const [entry] = window.benchBooks(3).slice(2);
    const view = window.benchView ||= model.bookView(document.getElementById('inner'), entry.book, entry.style, { width: entry.width,
      height: entry.height, thickness: entry.thickness, viewportWidth: 390, viewportHeight: 844, centerX: 195, centerY: 422, coverUrl: null });
    for (const gpu of [model.getBookRenderer(), model.getPresentationBookRenderer()].filter(Boolean)) gpu.render = () => {};
    const start = performance.now();
    for (let i = 0; i < frames; i++) {
      const t = (i % 91) / 90;
      view.draw({ x: -40 * t, y: 10 * t, scale: 1 + t, angle: 90 * (1 - t), pitch: 9 * (1 - t), roll: 0,
        coverOpen: t, bookmarkWithdraw: t, pageTheme: t });
    }
    return (performance.now() - start) / frames;
  }, frames);
}
if (args.includes('--case')) {
  // The case of each book: the original three.js construction (frozen copy) against the Rust module, interleaved.
  const result = await page.evaluate(async count => {
    const { model, reference } = await window.benchReady;
    const list = window.benchBooks(count), levels = [{ shelf:true, segments:32 }, { shelf:true, overview:true, segments:16 }, { segments:96 }];
    const run = (level, rust) => {
      const start = performance.now(), made = [];
      for (const e of list) {
        const board = e.height * .007, rim = level.overview ? 0 : board * 1.1, options = { shelf:Boolean(level.shelf), overview:Boolean(level.overview) };
        if (rust) { const c = model.bookCaseGeometries(e.width, e.height, board, e.thickness, { ...options, segments:level.segments, rim }); made.push(c.front, c.back, ...c.caps); }
        else made.push(reference.referenceFrontBoard(e.width, e.height, board, options), reference.referenceBoardGeometry(e.width, e.height, board, options),
          reference.referenceCapGeometry(e.width, e.thickness, level.segments, rim), reference.referenceCapGeometry(e.width, e.thickness, level.segments, rim));
      }
      const elapsed = performance.now() - start;
      for (const g of made) g.dispose();
      return elapsed;
    };
    const out = {};
    for (const level of levels) {
      const name = level.overview ? 'overview' : level.shelf ? 'shelf' : 'detail', times = { js:[], rust:[] };
      for (let round = 0; round < 12; round++) { times.js.push(run(level, false)); times.rust.push(run(level, true)); }
      for (const key of ['js', 'rust']) times[key] = times[key].slice(2).sort((a, b) => a - b);
      out[name] = { jsMedianMs:+times.js[5].toFixed(2), rustMedianMs:+times.rust[5].toFixed(2), jsMinMs:+times.js[0].toFixed(2), rustMinMs:+times.rust[0].toFixed(2) };
    }
    return out;
  }, books);
  console.log(JSON.stringify({ bench:`case geometry of ${books} books`, cpu, ...result }));
}

if (profile || motionProfile) {
  if (motionProfile) await motionRun(200);
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 100 });
  await cdp.send('Profiler.start');
  if (motionProfile) console.log('motion ms/frame', await motionRun(3000));
  else for (let r = 0; r < 3; r++) await createRound(books);
  const { profile: result } = await cdp.send('Profiler.stop');
  const self = new Map(), byId = new Map(result.nodes.map(node => [node.id, node]));
  const counts = new Map();
  for (const sample of result.samples) counts.set(sample, (counts.get(sample) || 0) + 1);
  let total = 0;
  for (const [id, count] of counts) {
    const node = byId.get(id), frame = node.callFrame;
    const key = `${frame.functionName || '(anon)'} ${frame.url.replace(/^.*\/inhouse-read\//, '').replace(/\?.*$/, '')}:${frame.lineNumber + 1}`;
    self.set(key, (self.get(key) || 0) + count); total += count;
  }
  const idle = self.get('(idle) :0') || 0, busy = total - idle, span = (result.endTime - result.startTime) / 1000;
  console.log(`profile: ${span.toFixed(0)} ms, ${total} samples, busy ${(100 * busy / total).toFixed(1)}%`);
  const top = [...self].filter(([key]) => key !== '(idle) :0').sort((a, b) => b[1] - a[1]).slice(0, 40);
  for (const [key, count] of top) console.log(`${(100 * count / busy).toFixed(1).padStart(5)}% ${(span * count / total).toFixed(1).padStart(7)} ms  ${key}`);
  // Callers (up to 3 JS frames) of the heaviest native canvas calls, and inclusive time of the app's own functions.
  const parent = new Map();
  for (const node of result.nodes) for (const child of node.children || []) parent.set(child, node.id);
  const label = node => `${node.callFrame.functionName || '(anon)'}@${node.callFrame.url.replace(/^.*\/inhouse-read\//, '').replace(/\?.*$/, '')}:${node.callFrame.lineNumber + 1}`;
  for (const name of ['drawImage', 'fillRect', 'scale', 'putImageData']) {
    const callers = new Map();
    for (const [id, count] of counts) {
      const node = byId.get(id);
      if (node.callFrame.functionName !== name) continue;
      const chain = [];
      for (let up = parent.get(id); up && chain.length < 3; up = parent.get(up)) chain.push(label(byId.get(up)));
      const key = chain.join(' < ');
      callers.set(key, (callers.get(key) || 0) + count);
    }
    console.log(`-- callers of ${name}`);
    for (const [key, count] of [...callers].sort((a, b) => b[1] - a[1]).slice(0, 6)) console.log(`   ${(100 * count / busy).toFixed(1).padStart(5)}%  ${key}`);
  }
  const inclusive = new Map();
  for (const [id, count] of counts) {
    const seen = new Set();
    for (let up = id; up; up = parent.get(up)) {
      const node = byId.get(up);
      if (!/src\/js\//.test(node.callFrame.url)) continue;
      const key = label(node);
      if (seen.has(key)) continue;
      seen.add(key); inclusive.set(key, (inclusive.get(key) || 0) + count);
    }
  }
  console.log('-- inclusive (app functions)');
  for (const [key, count] of [...inclusive].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(`   ${(100 * count / busy).toFixed(1).padStart(5)}%  ${key}`);
}

if (motion) {
  const result = await page.evaluate(async () => {
    const { model, THREE } = await window.benchReady;
    const [entry] = window.benchBooks(3).slice(2);
    const host = document.getElementById('inner');
    const measure = async stubGpu => {
      const view = model.bookView(host, entry.book, entry.style, { width: entry.width, height: entry.height,
        thickness: entry.thickness, viewportWidth: 390, viewportHeight: 844, centerX: 195, centerY: 422, coverUrl: null });
      const renderers = [model.getBookRenderer(), model.getPresentationBookRenderer()].filter(Boolean);
      const originals = renderers.map(gpu => gpu.render);
      if (stubGpu) for (const gpu of renderers) gpu.render = () => {};
      const frames = 90, times = [];
      for (let round = 0; round < 3; round++) for (let i = 0; i <= frames; i++) {
        const t = i / frames;
        const start = performance.now();
        view.draw({ x: -40 * t, y: 10 * t, scale: 1 + t, angle: 90 * (1 - t), pitch: 9 * (1 - t), roll: 0,
          coverOpen: t, bookmarkWithdraw: t, pageTheme: t });
        times.push(performance.now() - start);
      }
      renderers.forEach((gpu, i) => { gpu.render = originals[i]; });
      view.dispose();
      times.sort((a, b) => a - b);
      return { medianMs: +times[Math.floor(times.length / 2)].toFixed(3), p90Ms: +times[Math.floor(times.length * .9)].toFixed(3),
        meanMs: +(times.reduce((a, b) => a + b, 0) / times.length).toFixed(3) };
    };
    await measure(true);
    return { cpuOnly: await measure(true), withGpu: await measure(false) };
  });
  console.log(JSON.stringify({ bench: 'bookView.draw per frame (opening)', cpu, ...result }));
}
await browser.close();
