import { expect, test } from '@playwright/test';
import { createServer } from 'vite';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer as createHttpServer } from 'node:http';

// The real flyout view (bookView: the same class the flyout uses), the real
// room environment and lights, and the real relief engine on a drawn corpus of
// covers. Proves that every proposal paints a visible, moving relief and that
// choosing one links no shader program and issues no extra draw call.
const fixtureHtml = `<!doctype html><html><head><meta charset="utf-8"></head>
<body style="margin:0;background:#d9d6cf"><div id="host" style="position:relative;width:420px;height:520px"></div><script type="module">
// Count every program link before anything compiles one.
let links = 0;
for (const proto of [globalThis.WebGL2RenderingContext?.prototype, globalThis.WebGLRenderingContext?.prototype]) {
  if (!proto) continue;
  const original = proto.linkProgram;
  proto.linkProgram = function (program) { links++; return original.call(this, program); };
}
import { bookView, getBookRenderer } from '/inhouse-read/src/js/book-model.js';
import { analyzeCoverRelief, buildReliefMaps } from '/inhouse-read/src/js/cover-relief.js';
import { drawCoverCorpus, prepareCoverCorpusFonts, loadCoverCorpus } from '/inhouse-read/tests/e2e/helpers/cover-corpus.js';
const regenerate = ${process.env.IHR_RELIEF_REGENERATE === '1'};
if (regenerate) await prepareCoverCorpusFonts();
const corpus = regenerate ? drawCoverCorpus() : await loadCoverCorpus();
const urls = {};
const urlOf = async name => urls[name] ??= URL.createObjectURL(await new Promise(r => corpus[name].toBlob(r, 'image/png')));
const host = document.getElementById('host');
let view = null;
const W = 200, H = 300, VW = 420, VH = 520;
async function open(name, finish = 'satin', relief = null) {
  view?.dispose(); host.textContent = '';
  const coverUrl = await urlOf(name), canvas = corpus[name];
  const ratio = canvas.width / canvas.height, w = Math.round(H * Math.min(1, ratio) * (ratio > 1 ? 1 : 1)), h = H;
  const style = { color:'#143a2a', shade:'#0e2a1e', ink:'#fffaf0', coverRatio:ratio };
  const bookWidth = Math.round(H * ratio);
  view = bookView(host, { id:'relief:' + name, title:name, author:'', coverFinish:finish, spineSurfaceFinish:finish, pageEdgeFinish:'matte', coverRelief:relief },
    style, { width:Math.min(bookWidth, 330), height:H, thickness:44, viewportWidth:VW, viewportHeight:VH, centerX:VW / 2, centerY:VH / 2, coverUrl });
  await view.ready;
  // Match the editor: its cards are only enabled after this one-time warm-up.
  await view.prepareCoverRelief();
  view.draw({ x:0, y:0, scale:1.15, angle:0, pitch:0 });
  return true;
}
const gpu = getBookRenderer();
const counters = () => ({ links, calls:gpu.info.render.calls, programs:gpu.info.programs.length, textures:gpu.info.memory.textures, triangles:gpu.info.render.triangles });
const pose = (yaw, pitch) => view.draw({ x:0, y:0, scale:1.15, angle:yaw, pitch });
const shot = () => view.canvas.toDataURL('image/png').split(',')[1];
const pixels = () => { const c = view.canvas; return c.getContext('2d').getImageData(0, 0, c.width, c.height).data; };
function diff(a, b) {
  let total = 0, changed = 0, max = 0, n = 0;
  for (let i = 0; i < a.length; i += 4) {
    if (!a[i + 3] && !b[i + 3]) continue; n++;
    let d = 0; for (let c = 0; c < 3; c++) d = Math.max(d, Math.abs(a[i + c] - b[i + c]));
    total += d; max = Math.max(max, d); if (d > 6) changed++;
  }
  return { mean:total / Math.max(1, n), max, changedFraction:changed / Math.max(1, n) };
}
window.reliefFixture = { names:Object.keys(corpus), open, counters, pose, shot, pixels, diff, urlOf, analyze:async name => analyzeCoverRelief(await urlOf(name), {}),
  sourceShots:() => Object.fromEntries(Object.entries(corpus).map(([name, canvas]) => [name, canvas.toDataURL('image/png').split(',')[1]])),
  apply:relief => view.setCoverRelief(relief), maps:async (name, relief) => { const m = await buildReliefMaps(await urlOf(name), relief, { maxSize:512 }); return { width:m.width ?? m.size.width, ms:m.stats.ms, longest:m.stats.longestSliceMs }; },
  render:() => view.draw(view.getPose()), model:() => view };
</script></body></html>`;

let server, httpServer, fixtureUrl;
test.beforeAll(async () => {
  server = await createServer({ configFile:false, root:process.cwd(), base:'/inhouse-read/',
    server:{ middlewareMode:true, hmr:false },
    plugins:[{ name:'real-cover-relief-fixture', configureServer(vite) {
      vite.middlewares.use(async (request, response, next) => {
        if (request.url?.split('?')[0] !== '/inhouse-read/__cover-relief') return next();
        try {
          const html = await vite.transformIndexHtml('/inhouse-read/__cover-relief', fixtureHtml);
          response.statusCode = 200; response.setHeader('Content-Type', 'text/html'); response.end(html);
        } catch (error) { next(error); }
      });
    } }] });
  httpServer = createHttpServer(server.middlewares);
  await new Promise(resolve => httpServer.listen(0, '127.0.0.1', resolve));
  fixtureUrl = 'http://127.0.0.1:' + httpServer.address().port + '/inhouse-read/__cover-relief';
});
test.afterAll(async () => {
  httpServer?.closeAllConnections();
  if (httpServer) await new Promise((resolve, reject) => httpServer.close(error => error ? reject(error) : resolve()));
  await server?.close();
});

const EVIDENCE = process.env.IHR_RELIEF_EVIDENCE_DIR;
// Each render is slow on software GL: the default set covers foil+frame, band+lettering and a motif under all three laminates.
const CASES = process.env.IHR_RELIEF_CASES ? JSON.parse(process.env.IHR_RELIEF_CASES)
  : [['01-ornate-classic', 'satin'], ['06-nonfiction-band', 'matte'], ['03-illustrated', 'glossy']];
async function save(name, base64) {
  if (!EVIDENCE) return;
  await mkdir(EVIDENCE, { recursive:true });
  await writeFile(EVIDENCE + '/' + name + '.png', Buffer.from(base64, 'base64'));
}

async function boot(page) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error' && /THREE\.WebGLProgram|VALIDATE_STATUS|shader|GL_INVALID|Failed to load module/i.test(message.text())) errors.push(message.text());
  });
  await page.goto(fixtureUrl);
  await page.waitForFunction(() => window.reliefFixture, null, { timeout:60_000 });
  return errors;
}

test('cada cover del corpus recibe exactamente tres propuestas distintas y el análisis cede el hilo principal', async ({ page }) => {
  test.setTimeout(280_000);
  const errors = await boot(page);
  const report = await page.evaluate(async () => {
    const api = window.reliefFixture, out = [];
    for (const name of api.names) {
      const first = await api.analyze(name), second = await api.analyze(name);
      out.push({ name, ids:first.proposals.map(p => p.id), again:second.proposals.map(p => p.id),
        labels:first.proposals.map(p => p.label), descriptions:first.proposals.map(p => p.description),
        confidences:first.proposals.map(p => p.confidence), detected:first.proposals.map(p => p.detected),
        thumbnails:first.proposals.every(p => /^data:image\//.test(p.thumbnail)), analysis:first.analysis });
    }
    return out;
  });
  console.info('Relief corpus report:', JSON.stringify(report.map(({ name, ids, confidences, analysis }) => ({ name, ids, confidences, ms:analysis.ms, p95:analysis.p95SliceMs, longest:analysis.longestSliceMs }))));
  if (EVIDENCE) await mkdir(EVIDENCE, { recursive:true }).then(() => writeFile(EVIDENCE + '/corpus-report.json', JSON.stringify(report, null, 1)));
  if (EVIDENCE) for (const [name, png] of Object.entries(await page.evaluate(() => window.reliefFixture.sourceShots()))) await save(name + '-source', png);
  for (const item of report) {
    expect(item.ids, item.name).toHaveLength(3);
    expect(new Set(item.ids).size, item.name + ' no repite familias').toBe(3);
    expect(item.again, item.name + ' es determinista').toEqual(item.ids);
    expect(item.thumbnails).toBe(true);
    expect(item.confidences).toEqual([...item.confidences].sort((a, b) => b - a));
    for (const [index, detected] of item.detected.entries()) {
      // A suggestion never claims a detection.
      if (!detected) expect(item.descriptions[index]).toMatch(/Sugerencia/);
    }
  }
  const byName = Object.fromEntries(report.map(item => [item.name, item]));
  expect(byName['01-ornate-classic'].ids).toEqual(expect.arrayContaining(['foil', 'frame']));
  expect(byName['06-nonfiction-band'].ids).toEqual(expect.arrayContaining(['band', 'lettering']));
  expect(byName['03-illustrated'].ids).toContain('emblem');
  expect(byName['07-bw-scan'].ids).toContain('frame');
  expect(errors).toEqual([]);
});

test('elegir un relieve no enlaza programas, no añade llamadas de dibujo y se ve al inclinar el libro', async ({ page }) => {
  test.setTimeout(Math.max(280_000, CASES.length * 100_000));
  const errors = await boot(page);
  const angles = [[-14, 7], [-7, -4], [0, 0], [7, 4], [14, -7]];
  const result = await page.evaluate(async ([angles_, cases_]) => {
    const api = window.reliefFixture, out = {};
    for (const [name, finish] of cases_) {
      await api.open(name, finish);
      const proposals = (await api.analyze(name)).proposals;
      api.pose(0, 0); api.render(); api.pose(8, 4); api.render();
      const baseline = {};
      for (const [yaw, pitch] of angles_) { api.pose(yaw, pitch); baseline[yaw + ':' + pitch] = api.pixels().slice(); }
      const rows = [];
      for (const proposal of proposals) {
        api.pose(0, 0); api.render();
        const before = api.counters();
        const started = performance.now();
        const applied = await api.apply({ id:proposal.id, strength:proposal.strength });
        const elapsed = performance.now() - started;
        api.pose(0, 0); api.render();
        const after = api.counters();
        const shots = [], changes = [], motion = [];
        let previous = null;
        for (const [yaw, pitch] of angles_) {
          api.pose(yaw, pitch);
          const now = api.pixels().slice();
          changes.push(api.diff(baseline[yaw + ':' + pitch], now));
          if (previous) motion.push(api.diff(previous, now));
          previous = now;
          shots.push({ yaw, pitch, png:api.shot() });
        }
        rows.push({ id:proposal.id, applied, elapsed, before, after, changes, motion, shots });
        await api.apply(null);
        api.pose(0, 0); api.render();
      }
      out[name + ':' + finish] = rows;
    }
    return out;
  }, [angles, CASES]);
  const summary = {};
  for (const [key, rows] of Object.entries(result)) {
    summary[key] = rows.map(row => ({ id:row.id, applied:row.applied, ms:Math.round(row.elapsed), linksBefore:row.before.links, linksAfter:row.after.links,
      calls:[row.before.calls, row.after.calls], textures:[row.before.textures, row.after.textures],
      meanChange:row.changes.map(c => +c.mean.toFixed(2)), maxChange:Math.max(...row.changes.map(c => c.max)), motion:row.motion.map(c => +c.mean.toFixed(2)) }));
    for (const row of rows) for (const shot of row.shots) await save(`${key.replace(':', '-')}-${row.id}-yaw${shot.yaw}-pitch${shot.pitch}`, shot.png);
  }
  console.info('Relief rendering summary:', JSON.stringify(summary));
  if (EVIDENCE) await writeFile(EVIDENCE + '/render-summary.json', JSON.stringify(summary, null, 1));
  for (const [key, rows] of Object.entries(result)) for (const row of rows) {
    const label = key + ' ' + row.id;
    expect(row.applied, label).toBe(true);
    expect(row.after.links, label + ': elegir un relieve no debe enlazar programas').toBe(row.before.links);
    expect(row.after.programs, label).toBe(row.before.programs);
    expect(row.after.calls, label + ': ni añadir llamadas de dibujo').toBeLessThanOrEqual(row.before.calls);
    // The relief must visibly change the cover at a small tilt, and its highlights must move with the tilt.
    expect(Math.max(...row.changes.map(c => c.changedFraction)), label + ' se nota').toBeGreaterThan(.0015);
    expect(Math.max(...row.motion.map(c => c.mean)), label + ' los reflejos se mueven').toBeGreaterThan(.05);
  }
  expect(errors).toEqual([]);
});
