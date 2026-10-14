import { expect, test } from '@playwright/test'
import { createServer } from 'vite'
import { createServer as createHttpServer } from 'node:http'

// CPU observation with the actual compiled artifact and production bridge.
// It does not assert elapsed time or stand in for a physical Android profile.
const fixtureHtml = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body><script type="module">
import { loadRustCore } from '/inhouse-read/src/js/rust-core.js';
import { pdfColumnCut, rustPDFColumnCut } from '/inhouse-read/tests/unit/helpers/pdf-column-cut-bridge.js';
import { legacyPDFColumnCut } from '/inhouse-read/tests/unit/helpers/reference-pdf-pipeline.js';
const started = performance.now();
const core = await loadRustCore();
if (!core?.pdf_column_cut) throw new Error('The compiled PDF kernel did not load');
const loadMs = performance.now() - started;
const fields = ['x0','x1','top','bottom','y','height'];
const pause = () => new Promise(resolve => setTimeout(resolve,0));
const median = values => [...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];
function linesFor(kind,count) {
  const columns = kind === 'paragraph' ? 1 : 2;
  const width = kind === 'table' ? 60 : 160;
  return Array.from({length:count},(_,index)=>{
    const column = index % columns, row = Math.floor(index / columns);
    const x0 = 20 + column * 210, y = 36 + row * 18, height = 12;
    return {id:index,x0,x1:x0+width,top:y-height,bottom:y,y,height};
  }).reverse(); // Preserve the original order of each partition, not sorted IDs.
}
function signature(value) {
  if (!value) return {kind:0};
  if (value.table) return {kind:2};
  return {kind:1,at:value.at,score:value.score,
    left:value.left.map(line=>line.id),right:value.right.map(line=>line.id),crossing:value.crossing.map(line=>line.id)};
}
function parity(actual,expected,label) {
  if (actual === undefined) throw new Error(label + ' silently fell back');
  if (JSON.stringify(signature(actual)) !== JSON.stringify(signature(expected))) throw new Error(label+' partitions differ');
  if (expected?.left) {
    if (!Object.is(actual.at,expected.at) || !Object.is(actual.score,expected.score)) throw new Error(label+' f64 result differs');
    for (const side of ['left','right','crossing']) {
      for (let index=0;index<expected[side].length;index++) {
        if (actual[side][index] !== expected[side][index]) throw new Error(label+' source identity differs');
      }
    }
  }
}
function resident(lines) {
  const size=lines.length*6,length=size+3,pointer=core.alloc_f64(length);
  if (!pointer) throw new Error('Resident comparison allocation failed');
  const view=new Float64Array(core.memory.buffer,pointer,size);
  for(let index=0;index<lines.length;index++) for(let field=0;field<6;field++)view[index*6+field]=lines[index][fields[field]];
  return {
    run:()=>core.pdf_column_cut(pointer,lines.length,pointer+size*8),
    result:()=>Array.from(new Float64Array(core.memory.buffer,pointer+size*8,3)),
    free:()=>core.free_f64(pointer,length)
  };
}
window.observeRustPDF = async () => {
  const report=[];
  for(const count of [4,12,80,240,1280]) for(const kind of ['paragraph','columns','table']) {
    const lines=linesFor(kind,count),sourceBefore=JSON.stringify(lines),expected=legacyPDFColumnCut(lines);
    parity(rustPDFColumnCut(lines),expected,'Rust bridge');
    parity(pdfColumnCut(lines),expected,'Production routing');
    const direct=resident(lines);
    try {
      direct.run();
      const raw=direct.result(),expectedRaw=expected?.table?[2,0,0]:expected?[1,expected.at,expected.score]:[0,0,0];
      if(!raw.every((number,index)=>Object.is(number,expectedRaw[index]))) throw new Error('Resident WASM differs');
      const jobs={js:()=>legacyPDFColumnCut(lines),rust:()=>rustPDFColumnCut(lines),resident:()=>direct.run()};
      const repetitions=kind==='paragraph'?32:count<=12?64:count<=80?16:count<=240?4:1;
      for(let warm=0;warm<3;warm++) { for(const run of Object.values(jobs)) for(let n=0;n<repetitions;n++)run(); await pause(); }
      const batches={js:[],rust:[],resident:[]};
      for(let round=0;round<15;round++) {
        // Alternate both comparison direction and the resident diagnostic's
        // position. No output comparison or JSON work is in a timed interval.
        const order=round%2?['resident','rust','js']:['js','rust','resident'];
        for(const name of order) {
          const start=performance.now();
          for(let n=0;n<repetitions;n++)jobs[name]();
          batches[name].push(performance.now()-start);
          await pause();
        }
      }
      parity(rustPDFColumnCut(lines),expected,'Final Rust bridge');
      parity(pdfColumnCut(lines),expected,'Final production routing');
      if(JSON.stringify(lines)!==sourceBefore) throw new Error('Source geometry changed');
      const jsMedianMs=median(batches.js)/repetitions,rustMedianMs=median(batches.rust)/repetitions;
      const residentMedianMs=median(batches.resident)/repetitions;
      report.push({kind,count,repetitions,signature:signature(expected),exactParity:true,inputPreserved:true,batches,
        jsMedianMs,rustMedianMs,residentMedianMs,
        bridgeExtraMedianMs:rustMedianMs-residentMedianMs,
        bridgeExtraDefinition:'difference of medians: allocation, copies, validation, partition reconstruction and freeing; timer noise can make it negative',
        ratio:rustMedianMs>0?jsMedianMs/rustMedianMs:null});
    } finally { direct.free(); }
    await pause();
  }
  return {abi:core.core_abi_version(),loadMs,userAgent:navigator.userAgent,wasmMemoryBytes:core.memory.buffer.byteLength,report};
};
window.rustPDFReady=true;
</script></body></html>`

let server,httpServer,fixtureUrl
test.beforeAll(async()=>{
  server=await createServer({configFile:false,root:process.cwd(),base:'/inhouse-read/',
    optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true,hmr:false,watch:null},
    plugins:[{name:'rust-pdf-browser-fixture',configureServer(vite){
      vite.middlewares.use(async(request,response,next)=>{
        if(request.url?.split('?')[0]!=='/inhouse-read/__rust-pdf')return next()
        try {
          const html=await vite.transformIndexHtml('/inhouse-read/__rust-pdf',fixtureHtml)
          response.statusCode=200;response.setHeader('Content-Type','text/html');response.end(html)
        } catch(error){next(error)}
      })
    }}]})
  httpServer=createHttpServer(server.middlewares)
  await new Promise(resolve=>httpServer.listen(0,'127.0.0.1',resolve))
  fixtureUrl='http://127.0.0.1:'+httpServer.address().port+'/inhouse-read/__rust-pdf'
})
test.afterAll(async()=>{
  httpServer?.closeAllConnections()
  if(httpServer)await new Promise((resolve,reject)=>httpServer.close(error=>error?reject(error):resolve()))
  await server?.close()
})

test('compiled PDF column detection preserves partitions and records bridge cost at mobile viewport',async({page,context},testInfo)=>{
  await page.setViewportSize({width:390,height:844})
  const errors=[];page.on('pageerror',error=>errors.push(error.message))
  const cdp=await context.newCDPSession(page)
  await cdp.send('Emulation.setCPUThrottlingRate',{rate:1})
  await page.goto(fixtureUrl)
  await page.waitForFunction(()=>window.rustPDFReady===true)
  const report=await page.evaluate(()=>window.observeRustPDF())
  const observation={cpuRate:1,viewport:{width:390,height:844},device:'desktop Chromium, not a physical mobile',...report}
  await testInfo.attach('rust-pdf-browser-observation.json',{body:Buffer.from(JSON.stringify(observation,null,2)),contentType:'application/json'})
  expect(errors).toEqual([])
  expect(report.abi).toBe(1)
  expect(report.report).toHaveLength(15)
  for(const row of report.report){
    expect(row.exactParity).toBe(true)
    expect(row.inputPreserved).toBe(true)
    for(const samples of Object.values(row.batches)){
      expect(samples).toHaveLength(15)
      expect(samples.every(value=>Number.isFinite(value)&&value>=0)).toBe(true)
    }
  }
  console.info('Rust PDF browser timings',JSON.stringify({loadMs:report.loadMs,
    cases:report.report.map(({kind,count,jsMedianMs,rustMedianMs,residentMedianMs,bridgeExtraMedianMs,ratio})=>
      ({kind,count,jsMedianMs,rustMedianMs,residentMedianMs,bridgeExtraMedianMs,ratio}))}))
})
