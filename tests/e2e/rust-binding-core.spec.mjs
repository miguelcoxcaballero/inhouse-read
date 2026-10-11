import { expect, test } from '@playwright/test';
import { createServer } from 'vite';
import { createServer as createHttpServer } from 'node:http';

// Real source modules and compiled WASM, with unchanged geometry quality.
// CPU x4 is desktop Chromium throttling, not a physical Android measurement.
const fixtures = [
  { name:'detail-plain', width:264, height:400, thickness:80, segments:96, rows:384, pattern:'none', repetitions:64 },
  { name:'shelf-plain', width:132, height:200, thickness:40, segments:32, rows:96, pattern:'none', repetitions:128 },
  { name:'overview-plain', width:132, height:200, thickness:40, segments:16, rows:384, pattern:'none', repetitions:128 },
  { name:'twelve-segment-compatibility', width:62.125, height:92.375, thickness:8.25, segments:12, rows:12, pattern:'none', repetitions:128 },
  { name:'shelf-engraved', width:132, height:200, thickness:40, segments:32, rows:96, pattern:'mask', repetitions:4 },
  { name:'detail-engraved', width:264, height:400, thickness:80, segments:96, rows:384, pattern:'mask', repetitions:1 },
  { name:'detail-smooth-relief', width:400, height:240, thickness:120, segments:96, rows:384, pattern:'wave', repetitions:1 },
  { name:'uint32-index-boundary', width:132, height:200, thickness:40, segments:255, rows:255, pattern:'mask', repetitions:1 },
];
const WARMUPS = 5, BATCHES = 15;
const fixtureHtml = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body><script>addEventListener('error', event => window.rustBindingFailure = event.message);addEventListener('unhandledrejection', event => window.rustBindingFailure = String(event.reason));</script><script type="module">
import { loadRustCore, getRustCore } from '/inhouse-read/src/js/rust-core.js';
import coreUrl from '/inhouse-read/src/wasm/inhouse_read_core.wasm?url';
import { rustBindingBuffers } from '/inhouse-read/src/js/binding-wasm.js';
import { bindingGeometry } from '/inhouse-read/src/js/book-model.js';
import { referenceBindingGeometry } from '/inhouse-read/tests/unit/helpers/reference-binding-geometry.js';
const started = performance.now();
const core = await loadRustCore();
if (!core || typeof core.binding_mesh !== 'function' || getRustCore() !== core) throw new Error('The actual compiled binding kernel did not load');
const loadMs = performance.now() - started;
const initialMemoryBytes = core.memory.buffer.byteLength;
const fixtures = ${JSON.stringify(fixtures)};
const mask = Uint8Array.from({length:64 * 256}, (_, index) => {
  const x = index % 64, y = Math.floor(index / 64);
  return x > 9 && x < 54 && y > 18 && y < 238 && ((Math.floor(y / 11) + Math.floor(x / 7)) % 3) ? 255 : 0;
});
const patterns = {
  none:null,
  mask:(u, v) => mask[Math.min(255, Math.floor(v * 256)) * 64 + Math.min(63, Math.floor(u * 64))] / 255,
  wave:(u, v) => Math.round((Math.sin(u * 27) * Math.cos(v * 41) + 1) * 127.5) / 255,
};
const argsFor = fixture => [fixture.width, fixture.height, fixture.thickness, fixture.segments, patterns[fixture.pattern], fixture.rows];
const pause = () => new Promise(resolve => setTimeout(resolve, 0));
const fields = geometry => ({ ...geometry.attributes, index:geometry.index });
async function sha(array) {
  if (!ArrayBuffer.isView(array)) throw new Error('Expected an actual numeric buffer');
  const raw = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', raw)), byte => byte.toString(16).padStart(2, '0')).join('');
}
async function describeGeometry(geometry) {
  const result = {};
  for (const [name, attribute] of Object.entries(fields(geometry))) {
    result[name] = { sha256:await sha(attribute.array), bytes:attribute.array.byteLength,
      type:attribute.array.constructor.name, count:attribute.count, itemSize:attribute.itemSize,
      normalized:attribute.normalized, version:attribute.version };
  }
  result.groups = geometry.groups;
  result.boundingBox = geometry.boundingBox;
  result.boundingSphere = geometry.boundingSphere;
  return result;
}
function equal(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(label + ' differs: ' + JSON.stringify({actual, expected}));
}
const statistics = values => {
  const sorted = [...values].sort((a, b) => a - b);
  return { samples:values, medianMs:sorted[Math.floor(sorted.length / 2)], p95Ms:sorted[Math.ceil(sorted.length * .95) - 1],
    totalMs:values.reduce((sum, value) => sum + value, 0) };
};
window.observeRustBinding = async name => {
  const fixture = fixtures.find(fixture => fixture.name === name);
  if (!fixture) throw new Error('Unknown fixture');
  const args = argsFor(fixture), maskBefore = await sha(mask);
  let live = 0, peak = 0, allocations = 0, releases = 0, kernelCalls = 0;
  // Instrument actual exports only for the untimed direct-call proof. No
  // mock or legacy implementation can satisfy these parity checks.
  const tracked = { ...core,
    alloc_f64(length) { const pointer = core.alloc_f64(length); if (pointer) { live += length * 8; peak = Math.max(peak, live); allocations++; } return pointer; },
    free_f64(pointer, length) { core.free_f64(pointer, length); live -= length * 8; releases++; },
    binding_mesh(...parameters) { kernelCalls++; return core.binding_mesh(...parameters); },
  };
  const expectedGeometry = referenceBindingGeometry(...args), actualGeometry = bindingGeometry(...args);
  let reference, production, direct;
  try {
    reference = await describeGeometry(expectedGeometry);
    production = await describeGeometry(actualGeometry);
    equal(production, reference, 'Production geometry contract');
    const buffers = rustBindingBuffers(tracked, ...args);
    if (!buffers || kernelCalls !== 1) throw new Error('The direct Rust bridge fell back');
    direct = {};
    for (const [key, attribute] of [['positions','position'], ['normals','normal'], ['uvs','uv'], ['indices','index']]) {
      const array = buffers[key];
      if (array.buffer === core.memory.buffer) throw new Error('Scratch escaped as an owned geometry buffer');
      direct[attribute] = { sha256:await sha(array), bytes:array.byteLength, type:array.constructor.name };
      equal(direct[attribute], {sha256:reference[attribute].sha256, bytes:reference[attribute].bytes, type:reference[attribute].type}, 'Direct Rust ' + attribute);
    }
    if (live !== 0 || allocations !== releases) throw new Error('The direct bridge retained an allocation');
  } finally { expectedGeometry.dispose(); actualGeometry.dispose(); }
  const jobs = { javascript:() => referenceBindingGeometry(...args), rust:() => bindingGeometry(...args) };
  const run = kind => {
    let checksum = 0;
    for (let index = 0; index < fixture.repetitions; index++) {
      const geometry = jobs[kind]();
      try {
        checksum += geometry.attributes.position.array[1] + geometry.attributes.normal.array[2]
          + geometry.attributes.uv.array[3] + geometry.index.array[geometry.index.count - 1];
      } finally { geometry.dispose(); }
    }
    return checksum;
  };
  const expected = run('javascript');
  for (let warm = 0; warm < ${WARMUPS}; warm++) {
    for (const kind of ['javascript','rust']) if (!Object.is(run(kind), expected)) throw new Error('Warm-up checksum differs');
    await pause();
  }
  const samples = { javascript:[], rust:[] }, orders = [];
  for (let round = 0; round < ${BATCHES}; round++) {
    const order = round % 2 ? ['rust','javascript'] : ['javascript','rust']; orders.push(order);
    for (const kind of order) {
      const before = performance.now(), checksum = run(kind);
      samples[kind].push(performance.now() - before);
      if (!Object.is(checksum, expected)) throw new Error('Measured checksum differs');
      await pause();
    }
  }
  const finalExpected = referenceBindingGeometry(...args), finalActual = bindingGeometry(...args);
  try {
    equal(await describeGeometry(finalExpected), reference, 'Final reference');
    equal(await describeGeometry(finalActual), reference, 'Final production');
  } finally { finalExpected.dispose(); finalActual.dispose(); }
  if (await sha(mask) !== maskBefore) throw new Error('Input mask changed');
  const response = await fetch(coreUrl);
  if (!response.ok) throw new Error('Could not identify the compiled artifact');
  const artifactBytes = new Uint8Array(await response.arrayBuffer());
  const javascript = statistics(samples.javascript), rust = statistics(samples.rust);
  return { fixture, abi:core.core_abi_version(), loadMs, userAgent:navigator.userAgent,
    artifact:{bytes:artifactBytes.byteLength,sha256:await sha(artifactBytes)},
    exactParity:true, inputPreserved:true, reference, production, direct, orders, javascript, rust,
    javascriptPerGeometryMedianMs:javascript.medianMs / fixture.repetitions,
    rustPerGeometryMedianMs:rust.medianMs / fixture.repetitions,
    memory:{initialWasmCapacityBytes:initialMemoryBytes,finalWasmCapacityBytes:core.memory.buffer.byteLength,
      liveArenaBytesAfterRelease:live,peakLiveArenaBytes:peak,allocations,releases,actualDirectKernelCalls:kernelCalls} };
};
window.rustBindingReady = true;
</script></body></html>`;

let server, httpServer, fixtureUrl;
test.beforeAll(async () => {
  server = await createServer({ configFile:false, root:process.cwd(), base:'/inhouse-read/',
    optimizeDeps:{ noDiscovery:true, include:[] }, server:{ middlewareMode:true, hmr:false, watch:null },
    plugins:[{ name:'rust-binding-browser-fixture', configureServer(vite) {
      vite.middlewares.use(async (request, response, next) => {
        if (request.url?.split('?')[0] !== '/inhouse-read/__rust-binding') return next();
        try {
          const html = await vite.transformIndexHtml('/inhouse-read/__rust-binding', fixtureHtml);
          response.statusCode = 200; response.setHeader('Content-Type', 'text/html'); response.end(html);
        } catch (error) { next(error); }
      });
    } }] });
  httpServer = createHttpServer(server.middlewares);
  await new Promise(resolve => httpServer.listen(0, '127.0.0.1', resolve));
  fixtureUrl = 'http://127.0.0.1:' + httpServer.address().port + '/inhouse-read/__rust-binding';
});
test.afterAll(async () => {
  httpServer?.closeAllConnections();
  if (httpServer) await new Promise((resolve, reject) => httpServer.close(error => error ? reject(error) : resolve()));
  await server?.close();
});
test.use({ viewport:{ width:390, height:844 }, deviceScaleFactor:2, isMobile:true, hasTouch:true });

for (const fixture of fixtures) {
  test(`real Rust binding keeps exact ${fixture.name} geometry at mobile viewport and CPU x4`, async ({ page, context }, testInfo) => {
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate:4 });
    await page.goto(fixtureUrl);
    await page.waitForFunction(() => window.rustBindingReady === true || window.rustBindingFailure);
    expect(await page.evaluate(() => window.rustBindingFailure)).toBeUndefined();
    const report = await page.evaluate(name => window.observeRustBinding(name), fixture.name);
    const observation = { cpuRate:4, viewport:{ width:390, height:844 },
      scope:'Desktop Chromium CPU throttling with mobile viewport. No GPU rendering, Android handset, whole-app speed, battery or temperature measurement.',
      methodology:{ warmupBatchesPerEngine:WARMUPS, measuredBatchesPerEngine:BATCHES,
        includes:'Production bindingGeometry: allocation/free, host trigonometry, relief callbacks, every bridge crossing, all owned output copies, Three attributes/index installation and disposal. Alternating order; full byte/contract parity before and after. No timing pass threshold.' }, ...report };
    await testInfo.attach('rust-binding-browser-observation.json', { body:Buffer.from(JSON.stringify(observation, null, 2)), contentType:'application/json' });
    expect(errors).toEqual([]); expect(report.abi).toBe(1);
    expect(report.exactParity).toBe(true); expect(report.inputPreserved).toBe(true);
    expect(report.production).toEqual(report.reference);
    expect(report.memory.actualDirectKernelCalls).toBe(1);
    expect(report.memory.allocations).toBe(report.memory.releases);
    expect(report.memory.liveArenaBytesAfterRelease).toBe(0);
    for (const name of ['javascript','rust']) {
      expect(report[name].samples).toHaveLength(BATCHES);
      expect(report[name].samples.every(value => Number.isFinite(value) && value >= 0)).toBe(true);
    }
    console.info('Rust binding browser observation', JSON.stringify({ name:fixture.name,
      javascriptPerGeometryMedianMs:report.javascriptPerGeometryMedianMs,
      rustPerGeometryMedianMs:report.rustPerGeometryMedianMs, artifact:report.artifact }));
  });
}
