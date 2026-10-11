import { expect, test } from '@playwright/test';
import { createServer } from 'vite';
import { createServer as createHttpServer } from 'node:http';

// A real browser loads the shipped WASM through its production loader and
// calls the production arena bridge. No mocked WASM, canvas scaling or GPU
// quality change is involved. CPU throttling is a desktop diagnostic, not a
// measurement of an Android handset, temperature, battery or app-frame rate.
const fixtureHtml = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body><script type="module">
import { loadRustCore } from '/inhouse-read/src/js/rust-core.js';
import { wasmInsideDistance, wasmBoxBlur, wasmHeightToNormals, wasmComposeMaterialMap,
  wasmComposeReliefLayers } from '/inhouse-read/src/js/cover-relief-wasm.js';
import { heightToNormals, composeMaterialMap, composeReliefLayerPixels, internals } from '/inhouse-read/src/js/cover-relief.js';
import { referenceDistance, referenceBlur, referenceNormals, referenceMaterial, referenceCompose,
  materialCoefficients, layers, mapsFor } from '/inhouse-read/tests/helpers/cover-relief-reference.mjs';
const started = performance.now();
const core = await loadRustCore();
if (!core) throw new Error('The actual Rust core did not load');
const loadMs = performance.now() - started;
const drain = task => { let step; do { step = task.next(); } while (!step.done); return step.value; };
async function sha(array) {
  if (!ArrayBuffer.isView(array)) throw new Error('The real Rust pass returned no numeric buffer');
  const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
}
const hashResult = async value => ArrayBuffer.isView(value) ? { output:await sha(value) }
  : Object.fromEntries(await Promise.all(['heightMap', 'mask', 'gloss', 'foil'].map(async name => [name, await sha(value[name])])));
const waitForInput = () => new Promise(resolve => setTimeout(resolve, 0));
window.observeRustRelief = async () => {
  const width = 384, height = 512, maps = mapsFor(width, height, 191);
  const unit = .6 / 255 / (2 * (200 / Math.max(width, height)));
  const options = { clearcoat:.35, roughness:.48, clearcoatRoughness:.28 };
  const coefficients = materialCoefficients(maps, options);
  const selection = { layers };
  const jobs = [
    { name:'distance', js:() => referenceDistance(maps.mask, width, height),
      rust:() => drain(wasmInsideDistance(core, maps.mask, width, height)),
      production:() => drain(internals.insideDistance(maps.mask, width, height)) },
    { name:'blur', js:() => referenceBlur(maps.baseHeight, width, height, 2),
      rust:() => drain(wasmBoxBlur(core, maps.baseHeight, width, height, 2)),
      production:() => drain(internals.boxBlur(maps.baseHeight, width, height, 2)) },
    { name:'normals', js:() => referenceNormals(maps),
      rust:() => drain(wasmHeightToNormals(core, maps, unit)),
      production:() => drain(heightToNormals(maps)) },
    { name:'material', js:() => referenceMaterial(maps, options),
      rust:() => drain(wasmComposeMaterialMap(core, maps, coefficients)),
      production:() => drain(composeMaterialMap(maps, options)) },
    { name:'layers', js:() => referenceCompose(maps, layers),
      rust:() => drain(wasmComposeReliefLayers(core, maps, layers)),
      production:() => drain(composeReliefLayerPixels(maps, selection)) }
  ];
  const sourceBefore = await Promise.all([maps.heightMap, maps.mask, maps.owners, maps.baseHeight].map(sha));
  const report = [];
  for (const job of jobs) {
    // Hash all output bytes before measuring, including actual production
    // routing. The direct Rust call cannot quietly fall back to JavaScript.
    const reference = await hashResult(job.js());
    const rust = await hashResult(job.rust());
    const production = await hashResult(job.production());
    if (JSON.stringify(reference) !== JSON.stringify(rust) || JSON.stringify(reference) !== JSON.stringify(production)) {
      throw new Error('Byte parity failed for ' + job.name + ': ' + JSON.stringify({ reference, rust, production }));
    }
    // Both implementations receive the same warm-up; alternating order limits
    // first/second bias. WASM timings include allocation, input copying, every
    // JS/WASM crossing, output copying and release, not only the inner loop.
    for (let warm = 0; warm < 2; warm++) { job.js(); job.rust(); await waitForInput(); }
    const samples = { js:[], rust:[] };
    for (let round = 0; round < 6; round++) {
      for (const kind of round % 2 ? ['rust', 'js'] : ['js', 'rust']) {
        const start = performance.now();
        job[kind]();
        samples[kind].push(performance.now() - start);
        await waitForInput();
      }
    }
    const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
    report.push({ name:job.name, referenceSha256:reference, rustSha256:rust, productionSha256:production,
      samples, jsMedianMs:median(samples.js), rustMedianMs:median(samples.rust),
      ratio:median(samples.js) / median(samples.rust) });
  }
  return { abi:core.core_abi_version(), width, height, loadMs,
    inputPreserved:JSON.stringify(sourceBefore) === JSON.stringify(await Promise.all([maps.heightMap, maps.mask, maps.owners, maps.baseHeight].map(sha))),
    userAgent:navigator.userAgent, wasmMemoryBytes:core.memory.buffer.byteLength, report };
};
window.rustReliefReady = true;
</script></body></html>`;

let server, httpServer, fixtureUrl;
test.beforeAll(async () => {
  server = await createServer({ configFile:false, root:process.cwd(), base:'/inhouse-read/',
    optimizeDeps:{ noDiscovery:true, include:[] }, server:{ middlewareMode:true, hmr:false, watch:null },
    plugins:[{ name:'rust-relief-browser-fixture', configureServer(vite) {
      vite.middlewares.use(async (request, response, next) => {
        if (request.url?.split('?')[0] !== '/inhouse-read/__rust-relief') return next();
        try {
          const html = await vite.transformIndexHtml('/inhouse-read/__rust-relief', fixtureHtml);
          response.statusCode = 200; response.setHeader('Content-Type', 'text/html'); response.end(html);
        } catch (error) { next(error); }
      });
    } }] });
  httpServer = createHttpServer(server.middlewares);
  await new Promise(resolve => httpServer.listen(0, '127.0.0.1', resolve));
  fixtureUrl = 'http://127.0.0.1:' + httpServer.address().port + '/inhouse-read/__rust-relief';
});
test.afterAll(async () => {
  httpServer?.closeAllConnections();
  if (httpServer) await new Promise((resolve, reject) => httpServer.close(error => error ? reject(error) : resolve()));
  await server?.close();
});

for (const cpuRate of [1, 4]) {
  test(`real Rust relief retains exact pixels at mobile viewport, CPU rate ${cpuRate}`, async ({ page, context }, testInfo) => {
    await page.setViewportSize({ width:390, height:844 });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate:cpuRate });
    await page.goto(fixtureUrl);
    await page.waitForFunction(() => window.rustReliefReady === true);
    const report = await page.evaluate(() => window.observeRustRelief());
    const observation = { cpuRate, viewport:{ width:390, height:844 }, device:'desktop Chromium; CPU emulation, not a physical mobile', ...report };
    await testInfo.attach('rust-relief-browser-observation.json', { body:Buffer.from(JSON.stringify(observation, null, 2)), contentType:'application/json' });
    expect(errors).toEqual([]);
    expect(report.abi).toBe(1);
    expect(report.inputPreserved).toBe(true);
    expect(report.report).toHaveLength(5);
    for (const kernel of report.report) {
      expect(kernel.rustSha256).toEqual(kernel.referenceSha256);
      expect(kernel.productionSha256).toEqual(kernel.referenceSha256);
      expect(kernel.samples.js).toHaveLength(6);
      expect(kernel.samples.rust).toHaveLength(6);
    }
    console.info('Rust relief browser timings', JSON.stringify({ cpuRate, loadMs:report.loadMs,
      kernels:report.report.map(({ name, jsMedianMs, rustMedianMs, ratio }) => ({ name, jsMedianMs, rustMedianMs, ratio })) }));
  });
}
