import { expect, test } from '@playwright/test';
import { createServer } from 'vite';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer as createHttpServer } from 'node:http';

// This fixture uses the production book model and room environment. An A/B
// changes only the reflection uniform on the same material: a normal-map or
// vertex displacement accidentally applied to diffuse print cannot pass it.
const fixtureHtml = `<!doctype html><html><head><meta charset="utf-8"></head>
<body style="margin:0;background:#eee"><script type="module">
import * as THREE from 'three';
import { getBookRenderer, createBookModel, lightBookScene } from '/inhouse-read/src/js/book-model.js';
const W = 640, H = 760, width = 180, height = 260, thickness = 44;
const renderer = getBookRenderer();
if (!renderer) throw new Error('The real book renderer requires WebGL');
renderer.setPixelRatio(1); renderer.setSize(W, H); document.body.append(renderer.domElement);
const scene = lightBookScene(new THREE.Scene());
const camera = new THREE.OrthographicCamera(-200, 200, 237.5, -237.5, 1, 2000);
camera.position.z = 1000; camera.lookAt(0, 0, 0);
const point = new THREE.PointLight(0xffbe72, 10000, 1200, 2);
point.position.set(200, -25, -120); scene.add(point);
const style = { color:'#18364b', shade:'#122939', ink:'#fffaf0', coverRatio:width / height };
const book = { id:'reflection:blue-book', title:'LUZ Y PAPEL', author:'Ana Molina',
  spineFinish:'matte', spineSurfaceFinish:'glossy', coverFinish:'glossy', pageEdgeFinish:'matte' };
const frames = new Map();
const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
const context = canvas.getContext('2d', { willReadFrequently:true });
const print = document.createElement('canvas'); print.width = 512; print.height = 768;
const ink = print.getContext('2d'); ink.fillStyle = '#18364b'; ink.fillRect(0, 0, 512, 768);
ink.fillStyle = '#e4e7de'; ink.textAlign = 'center'; ink.font = '44px serif';
ink.fillText('LUZ Y PAPEL', 256, 145); ink.font = '24px serif'; ink.fillText('ANA MOLINA', 256, 615);
let model, cover, controls, strengths, mask;
function materialList() {
  const materials = new Set(); model.traverse(node => {
    for (const material of [].concat(node.material || [])) materials.add(material);
  }); return [...materials];
}
function project(point) {
  const p = point.applyMatrix4(model.getObjectByName('front-cover').matrixWorld).project(camera);
  return { x:(p.x + 1) * W / 2, y:(1 - p.y) * H / 2 };
}
function inside(x, y, points) {
  let contained = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i], b = points[j];
    if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x)
      contained = !contained;
  } return contained;
}
async function build({ resolution = 1024, seed = book.id, lifted = false, foil = false, fixedPrint = false } = {}) {
  if (model) { scene.remove(model); model.userData.dispose(); }
  const currentBook = { ...book, id:seed, spineFinish:foil ? 'gold' : 'matte', spineTextFinish:foil ? 'silver' : 'matte' };
  model = createBookModel(currentBook, style, width, height, thickness, null,
    lifted ? {} : { shelf:true, inspectionResolution:resolution });
  model.rotation.set(.244, Math.PI / 3, 0); scene.add(model);
  await model.userData.ready;
  const board = model.getObjectByName('front-cover');
  cover = [].concat(board.material)[0];
  if (fixedPrint) {
    // Texture fidelity naturally changes the printed grain. Hold that raster
    // fixed to test that zoom quality does not change the reflection shape.
    cover.map?.dispose(); cover.normalMap?.dispose(); cover.normalMap = null;
    cover.map = new THREE.CanvasTexture(print); cover.map.colorSpace = THREE.SRGBColorSpace;
    cover.map.anisotropy = Math.min(16, renderer.capabilities.getMaxAnisotropy()); cover.needsUpdate = true;
  }
  controls = materialList().map(material => material.userData.bookReflectionSurface).filter(Boolean);
  strengths = controls.map(control => control.uniforms.bookReflectionStrength.value);
  model.updateMatrixWorld(true); camera.updateMatrixWorld(true);
  const z = height * .007 / 2;
  const corners = [[-.42, -.44], [.42, -.44], [.42, .44], [-.42, .44]]
    .map(([x, y]) => project(new THREE.Vector3(width * x, height * y, z)));
  mask = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++)
    if (inside(x + .5, y + .5, corners)) mask.push((y * W + x) * 4);
  return profiles();
}
function profiles() {
  return materialList().filter(material => material.userData.bookReflectionSurface).map(material => {
    const u = material.userData.bookReflectionSurface.uniforms;
    return { phase:u.bookReflectionPhase.value.toArray(), strength:u.bookReflectionStrength.value,
      uvScale:u.bookReflectionUvScale.value.toArray() };
  });
}
function power(enabled) {
  controls.forEach((control, index) => {
    if (enabled) control.uniforms.bookReflectionStrength.value = strengths[index];
    else control.setStrength(0);
  });
}
function render(name) {
  renderer.render(scene, camera); context.clearRect(0, 0, W, H); context.drawImage(renderer.domElement, 0, 0);
  frames.set(name, context.getImageData(0, 0, W, H).data);
  return { drawCalls:renderer.info.render.calls, triangles:renderer.info.render.triangles,
    geometries:renderer.info.memory.geometries, textures:renderer.info.memory.textures,
    programs:renderer.info.programs.length };
}
function identity() {
  const meshes = [];
  model.traverse(mesh => {
    if (!mesh.geometry) return;
    const position = mesh.geometry.getAttribute('position');
    meshes.push({ name:mesh.name, geometry:mesh.geometry.uuid, vertices:position.count,
      positionVersion:position.version, indexVersion:mesh.geometry.index?.version,
      materials:[].concat(mesh.material).map(material => material.uuid) });
  }); return meshes;
}
function compare(a, b, threshold = 2) {
  const region = mask;
  const left = frames.get(a), right = frames.get(b);
  let total = 0, max = 0, changed = 0, alphaDifference = 0;
  for (const offset of region) {
    let pixel = 0;
    for (let channel = 0; channel < 3; channel++) {
      const delta = Math.abs(left[offset + channel] - right[offset + channel]);
      total += delta; pixel = Math.max(pixel, delta); max = Math.max(max, delta);
    }
    if (pixel > threshold) changed++;
  }
  for (let offset = 3; offset < left.length; offset += 4)
    alphaDifference += Math.abs(left[offset] - right[offset]);
  return { mean:total / (region.length * 3), maximum:max, changedFraction:changed / region.length,
    alphaDifference, pixels:region.length, threshold };
}
function diffuseOnly(enabled) {
  cover.specularIntensity = enabled ? 0 : 1; cover.clearcoat = enabled ? 0 : 1; cover.needsUpdate = true;
}
function finish(value) { model.userData.updateCoverAppearance({ coverFinish:value }); }
function lamp(value) { point.intensity = value ? 10000 : 0; }
function bindingVariant() {
  const material = model.getObjectByName('binding').material;
  return { anisotropy:material.anisotropy, programKey:material.customProgramCacheKey(),
    reflectionSurface:Boolean(material.userData.bookReflectionSurface) };
}
function image(name) {
  context.putImageData(new ImageData(new Uint8ClampedArray(frames.get(name)), W, H), 0, 0);
  return canvas.toDataURL('image/png').split(',')[1];
}
await build();
window.bookSurfaceFixture = { build, profiles, power, render, identity, compare, diffuseOnly, finish,
  lamp, bindingVariant, image, pose:(x, y) => { model.rotation.set(x, y, 0); model.updateMatrixWorld(true); } };
</script></body></html>`;

let server, httpServer, fixtureUrl;
test.beforeAll(async () => {
  server = await createServer({ configFile:false, root:process.cwd(), base:'/inhouse-read/',
    server:{ middlewareMode:true, hmr:false },
    plugins:[{ name:'real-book-reflection-fixture', configureServer(vite) {
      vite.middlewares.use(async (request, response, next) => {
        // Vite's inline-module proxy contains the HTML pathname too. Serving
        // the fixture there would replace its JavaScript with text/html.
        if (request.url?.split('?')[0] !== '/inhouse-read/__book-surface-reflections') return next();
        try {
          const html = await vite.transformIndexHtml('/inhouse-read/__book-surface-reflections', fixtureHtml);
          response.statusCode = 200; response.setHeader('Content-Type', 'text/html'); response.end(html);
        } catch (error) { next(error); }
      });
    } }] });
  // Vite resolves port:0 to its default development port. A node HTTP server
  // gives this fixture a truly ephemeral listener, independent of previews.
  httpServer = createHttpServer(server.middlewares);
  await new Promise(resolve => httpServer.listen(0, '127.0.0.1', resolve));
  fixtureUrl = 'http://127.0.0.1:' + httpServer.address().port + '/inhouse-read/__book-surface-reflections';
});
test.afterAll(async () => {
  httpServer?.closeAllConnections();
  if (httpServer) await new Promise((resolve, reject) => httpServer.close(error => error ? reject(error) : resolve()));
  await server?.close();
});

test('las ondulaciones solo modifican los reflejos reales y conservan el dibujo, la silueta y los recursos', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const errors = [];
  let ready = false, rejectSetup;
  const setupFailed = new Promise((resolve, reject) => { rejectSetup = reject; });
  setupFailed.catch(() => {});
  const report = message => {
    errors.push(message); console.error('Book reflection fixture error:', message);
    if (!ready) rejectSetup(new Error('Book reflection fixture initialization failed: ' + message));
  };
  page.on('pageerror', error => report(error.message));
  page.on('console', message => {
    if (message.type() === 'error' && /THREE\.WebGLProgram|VALIDATE_STATUS|shader.*(?:compil|link)|GL_INVALID|Failed to load module script/i.test(message.text()))
      report(message.text());
  });
  await page.goto(fixtureUrl);
  await Promise.race([page.waitForFunction(() => window.bookSurfaceFixture, null, { timeout:30_000 }), setupFailed]);
  ready = true;
  const result = await page.evaluate(async () => {
    const api = window.bookSurfaceFixture, metrics = {};
    api.render('warmup'); api.render('warmup');
    const initialGeometry = api.identity();
    for (const finish of ['glossy', 'satin']) {
      api.finish(finish);
      for (const source of ['window', 'warm-lamp']) {
        api.lamp(source === 'warm-lamp');
        api.power(false); const flat = api.render(finish + '-' + source + '-flat');
        api.power(true); const curved = api.render(finish + '-' + source + '-curved');
        metrics[finish + '-' + source] = api.compare(finish + '-' + source + '-flat', finish + '-' + source + '-curved',
          finish === 'satin' && source === 'window' ? 1 : 2);
        metrics[finish + '-' + source].resources = { flat, curved };
      }
    }
    const geometryUnchanged = JSON.stringify(initialGeometry) === JSON.stringify(api.identity());
    api.finish('glossy'); api.diffuseOnly(true);
    api.power(false); api.render('diffuse-flat'); api.power(true); api.render('diffuse-curved');
    metrics.diffuseOnly = api.compare('diffuse-flat', 'diffuse-curved');
    api.diffuseOnly(false); api.power(true); api.render('stable-a'); api.render('stable-b');
    metrics.repeatedRender = api.compare('stable-a', 'stable-b');

    // The same physical board must keep its waves when higher resolution
    // textures replace it during shelf zoom. Isolate that field from the
    // intentional resolution change in the procedural printed raster.
    const profile1024 = await api.build({ resolution:1024, fixedPrint:true });
    api.render('quality-1024');
    const profile2048 = await api.build({ resolution:2048, fixedPrint:true });
    api.render('quality-2048');
    metrics.quality = api.compare('quality-1024', 'quality-2048');
    api.render('same-seed-before');
    const profileSame = await api.build({ resolution:2048, fixedPrint:true });
    api.render('same-seed-after'); metrics.sameSeed = api.compare('same-seed-before', 'same-seed-after');
    await api.build({ seed:'reflection:another-book', resolution:2048, fixedPrint:true });
    api.render('other-seed'); metrics.otherSeed = api.compare('same-seed-after', 'other-seed');

    // Compile the existing grazing-fade and anisotropic-foil hooks together
    // with the new reflection field, including the close-up spine variant.
    const foilProfile = await api.build({ lifted:true, foil:true });
    const foilVariant = api.bindingVariant();
    api.pose(.12, .12); const liftedResources = api.render('lifted-foil');
    api.pose(.244, Math.PI / 3); api.render('lifted-foil-isometric');
    return { metrics, geometryUnchanged, profiles:{ profile1024, profile2048, profileSame, foilProfile }, liftedResources, foilVariant };
  });
  console.info('Book reflection surface metrics:', JSON.stringify(result));
  await testInfo.attach('reflection-only-metrics', { body:JSON.stringify(result, null, 2), contentType:'application/json' });
  for (const name of ['glossy-window-flat', 'glossy-window-curved', 'glossy-warm-lamp-curved',
    'satin-warm-lamp-curved', 'diffuse-curved', 'lifted-foil']) {
    const body = Buffer.from(await page.evaluate(name => window.bookSurfaceFixture.image(name), name), 'base64');
    await testInfo.attach(name, { body, contentType:'image/png' });
    if (process.env.IHR_REFLECTION_REVIEW_DIR) {
      await mkdir(process.env.IHR_REFLECTION_REVIEW_DIR, { recursive:true });
      await writeFile(process.env.IHR_REFLECTION_REVIEW_DIR + '/' + name + '.png', body);
    }
  }
  for (const finish of ['glossy', 'satin']) for (const source of ['window', 'warm-lamp']) {
    const metrics = result.metrics[finish + '-' + source];
    expect(metrics.pixels, 'Debe medir el interior de la portada real').toBeGreaterThan(10_000);
    expect(metrics.mean, 'El reflejo debe mostrar la irregularidad de la superficie').toBeGreaterThan(.08);
    // The broad satin window is deliberately low contrast. Its distributed
    // one-to-two-level changes in an 8-bit image are meaningful; sharp gloss
    // and the nearby warm lamp must still produce stronger local highlights.
    expect(metrics.maximum).toBeGreaterThan(finish === 'satin' && source === 'window' ? 1 : 3);
    expect(metrics.changedFraction).toBeGreaterThan(.01);
    expect(metrics.alphaDifference, 'La ondulación no debe deformar la silueta').toBe(0);
    expect(metrics.resources.curved, 'El cambio de reflejo no debe crear mallas, texturas o programas').toEqual(metrics.resources.flat);
  }
  expect(result.geometryUnchanged).toBe(true);
  expect(result.metrics.diffuseOnly.mean, 'Sin reflejo, la tinta y la iluminación difusa deben quedar idénticas').toBe(0);
  expect(result.metrics.diffuseOnly.maximum).toBe(0);
  expect(result.metrics.repeatedRender.mean).toBe(0);
  expect(result.metrics.sameSeed.mean).toBe(0);
  expect(result.metrics.quality.mean, 'El salto de calidad no debe cambiar la forma de los reflejos').toBeLessThan(.01);
  expect(result.profiles.profile1024).toEqual(result.profiles.profile2048);
  expect(result.profiles.profile2048).toEqual(result.profiles.profileSame);
  expect(result.metrics.otherSeed.mean, 'Cada libro conserva sus propias imperfecciones').toBeGreaterThan(.08);
  expect(result.profiles.foilProfile.length).toBeGreaterThan(3);
  expect(result.foilVariant.anisotropy).toBeGreaterThan(0);
  expect(result.foilVariant.reflectionSurface).toBe(true);
  expect(result.foilVariant.programKey).toContain('spine-grazing-fade');
  expect(result.liftedResources.drawCalls).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});
