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
import { Vector3 } from 'three';
import { bookView, getBookRenderer } from '/inhouse-read/src/js/book-model.js';
import { analyzeCoverRelief, buildReliefMaps } from '/inhouse-read/src/js/cover-relief.js';
import { drawCoverCorpus, prepareCoverCorpusFonts, loadCoverCorpus, loadColourMaskCorpus } from '/inhouse-read/tests/e2e/helpers/cover-corpus.js';
const regenerate = ${process.env.IHR_RELIEF_REGENERATE === '1'};
if (regenerate) await prepareCoverCorpusFonts();
const corpus = regenerate ? {...drawCoverCorpus(), ...await loadColourMaskCorpus()} : await loadCoverCorpus();
const urls = {};
const urlOf = async name => urls[name] ??= URL.createObjectURL(await new Promise(r => corpus[name].toBlob(r, 'image/png')));
const host = document.getElementById('host');
let view = null, bookWidthCurrent = 200;
const W = 200, H = 300, VW = 420, VH = 520;
async function open(name, finish = 'satin', relief = null) {
  view?.dispose(); host.textContent = '';
  const coverUrl = await urlOf(name), canvas = corpus[name];
  const ratio = canvas.width / canvas.height, w = Math.round(H * Math.min(1, ratio) * (ratio > 1 ? 1 : 1)), h = H;
  const style = { color:'#143a2a', shade:'#0e2a1e', ink:'#fffaf0', coverRatio:ratio };
  const bookWidth = Math.round(H * ratio); bookWidthCurrent = Math.min(bookWidth, 330);
  view = bookView(host, { id:'relief:' + name, title:name, author:'', coverFinish:finish, spineSurfaceFinish:finish, pageEdgeFinish:'matte', coverRelief:relief },
    style, { width:Math.min(bookWidth, 330), height:H, thickness:44, viewportWidth:VW, viewportHeight:VH, centerX:VW / 2, centerY:VH / 2, coverUrl });
  await view.ready;
  // Match the editor: its cards are only enabled after this one-time warm-up.
  await view.prepareCoverRelief();
  view.draw({ x:0, y:0, scale:1.15, angle:0, pitch:0 });
  return true;
}
const gpu = getBookRenderer();
let renderedScene, renderedCamera;
const renderOriginal = gpu.render;
gpu.render = function(scene,camera) { renderedScene=scene;renderedCamera=camera;return renderOriginal.call(this,scene,camera); };
const coverMaterial = () => renderedScene.getObjectByName('front-cover').material[0];
function sourceState() {
  const material=coverMaterial(),c=material.map.image,g=c.getContext('2d');
  let hash=2166136261;for(const value of g.getImageData(0,0,c.width,c.height).data)hash=Math.imul(hash^value,16777619);
  return {hash:hash>>>0,map:material.map.uuid,metalness:material.metalness,width:c.width,height:c.height};
}
function localized(before,after,color) {
  const palette=['#2350b5','#d4a93c','#fffaf0'],band=palette.indexOf(color.toLowerCase());
  if(band<0)throw Error('Independent geometry oracle requires an exact fixture colour');
  const mesh=renderedScene.getObjectByName('front-cover'),inside=[],outside=[],edgeInside=[],deltas=[];
  mesh.updateWorldMatrix(true,false);
  const sample=(u,v)=>{
    const point=new Vector3((u-.5)*bookWidthCurrent,(.5-v)*H,H*.007/2).applyMatrix4(mesh.matrixWorld).project(renderedCamera);
    const px=Math.round((point.x+1)*view.canvas.width/2),py=Math.round((1-point.y)*view.canvas.height/2);
    const index=(py*view.canvas.width+px)*4;
    if(px<0||py<0||px>=view.canvas.width||py>=view.canvas.height)throw Error('Projected fixture point out of frame');
    const delta=[0,1,2].map(c=>after[index+c]-before[index+c]);
    return {delta,amount:Math.max(...delta.map(Math.abs))};
  };
  for(let y=6;y<54;y++)for(let x=5;x<35;x++) {
    const u=x/40,v=y/60,region=Math.floor(v*3);
    if(Math.abs(v*3-Math.round(v*3))<.12)continue;
    const {delta,amount}=sample(u,v);
    (region===band?inside:outside).push(amount);
    if(region===band)deltas.push(delta);
  }
  // Geometry, not the generated mask, defines the embossing edge. The plateau
  // of white varnish over an already glossy white laminate changes little;
  // its visible relief is the bevel, which the distant-interior grid excludes.
  // Sample only inside each selected stripe, 0.3–3 cover units from its edge.
  const boundaries=[];
  if(band>0)boundaries.push([band/3,1]);
  if(band<2)boundaries.push([(band+1)/3,-1]);
  for(const [boundary,sign] of boundaries)for(const inset of [.001,.002,.003,.005,.007,.01])for(let x=5;x<35;x++) {
    edgeInside.push(sample(x/40,boundary+sign*inset).amount);
  }
  const stats=values=>({count:values.length,max:Math.max(...values),mean:values.reduce((a,b)=>a+b,0)/values.length,changed:values.filter(v=>v>1).length});
  return {inside:stats(inside),outside:stats(outside),edgeInside:stats(edgeInside),deltas};
}
// Independent standard OKLab conversion, no production helper or detector.
const toLab = rgb => {
  const [r,g,b]=rgb.map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);
  const l=Math.cbrt(.4122214708*r+.5363325363*g+.0514459929*b);
  const m=Math.cbrt(.2119034982*r+.6806995451*g+.1073969566*b);
  const z=Math.cbrt(.0883024619*r+.2817188376*g+.6299787005*b);
  return [100*(.2104542553*l+.793617785*m-.0040720468*z),100*(1.9779984951*l-2.428592205*m+.4505937099*z),100*(.0259040371*l+.7827717662*m-.808675766*z)];
};
async function maskOracle(name,choice) {
  const built=await buildReliefMaps(await urlOf(name),choice,{maxSize:512}),{width,height}=built.size;
  // Decode the same lossless source. Chrome resamples a GPU canvas differently
  // from an Image in a CPU canvas (photo differences up to 28/255); that would
  // compare two distinct rasters rather than validate the colour classifier.
  const image=new Image();image.src=await urlOf(name);await image.decode();
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
  const context=canvas.getContext('2d',{willReadFrequently:true});context.imageSmoothingQuality='high';context.drawImage(image,0,0,width,height);
  const rgba=context.getImageData(0,0,width,height).data, target=toLab(choice.color.slice(1).match(/../g).map(x=>parseInt(x,16)));
  const expected=new Uint8Array(width*height),core=new Uint8Array(width*height),actual=built.pixels;
  let selected=0,falsePositive=0,foil=0,outsideHeight=0,outsideGloss=0,outsideNormal=0,interior=0,missingInterior=0,flatInterior=0;
  for(let i=0;i<expected.length;i++) {
    const distance=Math.hypot(...toLab([...rgba.slice(i*4,i*4+3)]).map((value,c)=>value-target[c]));
    expected[i]=distance<choice.tolerance?1:0;
    core[i]=distance<choice.tolerance*.5?1:0;
    if(actual.mask[i]){selected++;if(!expected[i])falsePositive++;}
    if(actual.foil[i])foil++;
    if(!expected[i]) {
      if(actual.heightMap[i])outsideHeight++;if(actual.gloss[i])outsideGloss++;
      if(built.normal[i*4]!==128||built.normal[i*4+1]!==128||built.normal[i*4+2]!==255)outsideNormal++;
    }
  }
  for(let y=4;y<height-4;y++)for(let x=4;x<width-4;x++) {
    const i=y*width+x;let safe=Boolean(core[i]);
    for(let dy=-3;dy<=3&&safe;dy++)for(let dx=-3;dx<=3;dx++)if(!expected[(y+dy)*width+x+dx]){safe=false;break;}
    if(safe){interior++;if(!actual.mask[i])missingInterior++;if(built.normal[i*4]===128&&built.normal[i*4+1]===128&&built.normal[i*4+2]===255)flatInterior++;}
  }
  const maskCanvas=document.createElement('canvas');maskCanvas.width=width;maskCanvas.height=height;
  const maskRGBA=new Uint8ClampedArray(width*height*4);
  for(let i=0;i<actual.mask.length;i++){maskRGBA.set([actual.mask[i],actual.mask[i],actual.mask[i],255],i*4);}
  maskCanvas.getContext('2d').putImageData(new ImageData(maskRGBA,width,height),0,0);
  return {name,choice,width,height,selected,falsePositive,foil,outsideHeight,outsideGloss,outsideNormal,interior,missingInterior,flatInterior,
    maskPng:maskCanvas.toDataURL('image/png').split(',')[1]};
}
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
window.reliefFixture = { maskOracle, sourceState, localized, names:Object.keys(corpus), open, counters, pose, shot, pixels, diff, urlOf, analyze:async name => analyzeCoverRelief(await urlOf(name), {}),
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
// All three original laminates/artwork cases remain; proposals now select real colours.
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

test('el corpus recibe hasta tres colores reales distintos, sin familias inventadas, y el análisis cede el hilo principal', async ({ page }) => {
  test.setTimeout(280_000);
  const errors = await boot(page);
  const report = await page.evaluate(async () => {
    const api = window.reliefFixture, out = [];
    for (const name of api.names) {
      const first = await api.analyze(name), second = await api.analyze(name);
      out.push({ name, ids:first.proposals.map(p => p.id), again:second.proposals.map(p => p.id),
        colors:first.proposals.map(p=>p.color),tolerances:first.proposals.map(p=>p.tolerance),againColors:second.proposals.map(p=>p.color),
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
    expect(item.ids.length,item.name).toBeGreaterThan(0);
    expect(item.ids.length,item.name).toBeLessThanOrEqual(3);
    expect(item.ids).toEqual(['color-1','color-2','color-3'].slice(0,item.ids.length));
    expect(new Set(item.colors).size,item.name+' no repite colores').toBe(item.ids.length);
    expect(item.again,item.name+' IDs deterministas').toEqual(item.ids);
    expect(item.againColors,item.name+' HEX deterministas').toEqual(item.colors);
    expect(item.thumbnails).toBe(true);
    for(const [i,color] of item.colors.entries()) {
      expect(color).toMatch(/^#[0-9a-f]{6}$/);
      expect(item.tolerances[i]).toBeGreaterThanOrEqual(1);
      expect(item.tolerances[i]).toBeLessThanOrEqual(12);
      expect(item.detected[i]).toBe(true);
    }
    expect(item.analysis.slices,item.name+' yields').toBeGreaterThan(0);
  }
  const byName=Object.fromEntries(report.map(item=>[item.name,item]));
  expect(byName['13-rgb-exact'].colors.sort()).toEqual(['#2350b5','#d4a93c','#fffaf0'].sort());
  expect(byName['14-colour-antialias'].colors.sort()).toEqual(['#2350b5','#d4a93c','#fffaf0'].sort());
  expect(byName['17-single-colour'].colors).toEqual(['#2350b5']);
  expect(new Set(byName['18-two-colours'].colors)).toEqual(new Set(['#2350b5','#d4a93c']));
  expect(errors).toEqual([]);
});

test('las máscaras siguen sólo el color de RGB, antialias, JPEG y fotografía con normales y metal neutros fuera', async ({ page },testInfo) => {
  test.setTimeout(280_000);
  const errors=await boot(page);
  const rows=await page.evaluate(async()=>{
    const api=window.reliefFixture,rows=[];
    for(const name of ['13-rgb-exact','14-colour-antialias','15-colour-jpeg','16-cc0-flower-photo']) {
      for(const proposal of (await api.analyze(name)).proposals) rows.push(await api.maskOracle(name,proposal));
    }
    return rows;
  });
  const summary=rows.map(({maskPng,...row})=>row);
  await testInfo.attach('colour-mask-independent-oracles',{body:JSON.stringify(summary,null,2),contentType:'application/json'});
  if(EVIDENCE)await mkdir(EVIDENCE,{recursive:true}).then(()=>writeFile(EVIDENCE+'/mask-oracles.json',JSON.stringify(summary,null,2)));
  for(const row of rows)await save(row.name+'-'+row.choice.id+'-mask',row.maskPng);
  expect(rows).toHaveLength(12);
  for(const row of rows) {
    const label=row.name+' '+row.choice.color;
    expect(row.selected,label+' selecciona píxeles reales').toBeGreaterThan(20);
    expect(row.falsePositive,label+' no invade otros colores').toBe(0);
    expect(row.foil,label+' ningún pigmento se convierte en metal').toBe(0);
    expect(row.outsideHeight,label+' altura exterior cero').toBe(0);
    expect(row.outsideGloss,label+' brillo exterior cero').toBe(0);
    expect(row.outsideNormal,label+' normal exterior plana').toBe(0);
    expect(row.interior,label+' el oráculo tiene una región interior').toBeGreaterThan(20);
    expect(row.missingInterior,label+' no pierde el interior del color').toBe(0);
    if(row.name==='13-rgb-exact')expect(row.flatInterior,label+' sólo bisela bordes').toBe(row.interior);
  }
  expect(errors).toEqual([]);
});

test('el reflejo móvil queda localizado en cada color y conserva tinta, exterior y acabado mate, satinado y brillante', async ({ page },testInfo) => {
  test.setTimeout(360_000);
  const errors=await boot(page),angles=[[-14,7],[-7,-4],[0,0],[7,4],[14,-7]];
  const results=await page.evaluate(async angles=>{
    const api=window.reliefFixture,out=[];
    for(const finish of ['matte','satin','glossy']) {
      await api.open('13-rgb-exact',finish);
      const sourceBefore=api.sourceState(),proposals=(await api.analyze('13-rgb-exact')).proposals,baseline={},baseShots=[];
      for(const [yaw,pitch] of angles){api.pose(yaw,pitch);baseline[yaw+':'+pitch]=api.pixels().slice();baseShots.push({yaw,pitch,png:api.shot()});}
      for(const proposal of proposals) {
        const counters=api.counters();
        const applied=await api.apply(proposal),samples=[],shots=[];
        for(const [yaw,pitch] of angles) {
          api.pose(yaw,pitch);const current=api.pixels().slice();
          samples.push({...api.localized(baseline[yaw+':'+pitch],current,proposal.color),yaw,pitch});
          shots.push({yaw,pitch,png:api.shot()});
        }
        const motion=[];
        for(let i=1;i<samples.length;i++) {
          let delta=0,count=0;
          for(let j=0;j<samples[i].deltas.length;j++)for(let channel=0;channel<3;channel++) {
            delta+=Math.abs(samples[i].deltas[j][channel]-samples[i-1].deltas[j][channel]);count++;
          }
          motion.push(delta/count);
        }
        const sourceAfter=api.sourceState();
        out.push({finish,proposal,applied,sourceBefore,sourceAfter,before:counters,after:api.counters(),
          samples:samples.map(({deltas,...sample})=>sample),motion,shots,baseShots});
        await api.apply(null);api.render();
      }
    }
    return out;
  },angles);
  const summary=results.map(({shots,baseShots,...row})=>row);
  await testInfo.attach('localized-colour-reflections',{body:JSON.stringify(summary,null,2),contentType:'application/json'});
  if(EVIDENCE)await mkdir(EVIDENCE,{recursive:true}).then(()=>writeFile(EVIDENCE+'/localized-reflections.json',JSON.stringify(summary,null,2)));
  for(const row of results) {
    for(const shot of row.shots)await save('localized-'+row.finish+'-'+row.proposal.id+'-'+shot.yaw,shot.png);
    for(const shot of row.baseShots)await save('localized-base-'+row.finish+'-'+shot.yaw,shot.png);
  }
  expect(results).toHaveLength(9);
  for(const row of results) {
    const label=row.finish+' '+row.proposal.color;
    expect(row.applied,label).toBe(true);
    expect(row.sourceAfter,label+' la imagen impresa no cambia').toEqual(row.sourceBefore);
    expect(row.sourceAfter.metalness,label).toBe(0);
    expect(row.after.links,label).toBe(row.before.links);
    expect(row.after.programs,label).toBe(row.before.programs);
    expect(row.after.calls,label).toBeLessThanOrEqual(row.before.calls);
    for(const sample of row.samples) {
      expect(sample.inside.count,label+' interior muestreado').toBeGreaterThan(100);
      expect(sample.edgeInside.count,label+' borde interior muestreado').toBeGreaterThan(100);
      expect(sample.outside.count,label+' exterior muestreado').toBeGreaterThan(100);
      expect(sample.outside.max,label+' el exterior conserva sus píxeles').toBeLessThanOrEqual(1);
      expect(sample.outside.changed,label+' ningún píxel exterior cambia más de un nivel').toBe(0);
    }
    expect(Math.max(...row.samples.map(sample=>sample.edgeInside.max)),label+' bisel visible dentro del color seleccionado').toBeGreaterThan(6);
    // Do not require a flat white plateau to be recolored: retain a measurable
    // specular change there, plus the same >6 contrast at its real embossed edge.
    expect(Math.max(...row.samples.map(sample=>sample.inside.max)),label+' reflejo del interior plano').toBeGreaterThan(row.proposal.color==='#fffaf0'?0:6);
    expect(Math.max(...row.motion),label+' cambia el reflejo, no sólo la pose del libro').toBeGreaterThan(.05);
  }
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
        const applied = await api.apply({ id:proposal.id, color:proposal.color, tolerance:proposal.tolerance, strength:proposal.strength });
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
