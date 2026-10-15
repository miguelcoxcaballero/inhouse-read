import {test,expect} from '@playwright/test';
import {createServer} from 'vite';
import {createServer as createHttpServer} from 'node:http';
import {reliefPaletteCases} from '../helpers/relief-palette-cases.mjs';
const html=`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><script type="module">
import {loadRustCore} from '/inhouse-read/src/js/rust-core.js';
import coreUrl from '/inhouse-read/src/wasm/inhouse_read_core.wasm?url';
import * as original from '/inhouse-read/tests/unit/helpers/reference-relief-palette.js';
import '/inhouse-read/tests/e2e/helpers/shelf-ready.js';
import * as production from '/inhouse-read/src/js/cover-relief.js';
import {observeReliefPalette} from '/inhouse-read/tests/helpers/relief-palette-benchmark.mjs';
import {loadCoverCorpus,loadColourMaskCorpus} from '/inhouse-read/tests/e2e/helpers/cover-corpus.js';
const core=await loadRustCore();if(!core?.relief_analysis_new)throw new Error('Compiled relief job core required');
const hash=async data=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',ArrayBuffer.isView(data)?new Uint8Array(data.buffer,data.byteOffset,data.byteLength):data))].map(n=>n.toString(16).padStart(2,'0')).join('');
const artifact=async()=>{const response=await fetch(coreUrl);if(!response.ok)throw new Error('WASM HTTP failed');const bytes=await response.arrayBuffer();return {bytes:bytes.byteLength,sha256:await hash(bytes)};};
const pause=()=>new Promise(resolve=>setTimeout(resolve,0));
window.palettePure=async input=>({...await observeReliefPalette({input,original,production,core,hash,stats:window.paletteStats,pause}),artifact:await artifact()});
const median=values=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];
const semantic=result=>{const {ms,slices,longestSliceMs,medianSliceMs,p95SliceMs,...analysis}=result.analysis;return {proposals:result.proposals,analysis};};
window.paletteCover=async(name,previews)=>{
  const corpus=name.startsWith('16-')?await loadColourMaskCorpus():await loadCoverCorpus(),canvas=corpus[name];
  if(!canvas)throw new Error('Missing real cover');
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
  const url=URL.createObjectURL(blob),samples={javascript:[],rust:[]},details=[],longTasks=[];
  const observer=typeof PerformanceObserver==='function'?new PerformanceObserver(list=>longTasks.push(...list.getEntries().map(entry=>entry.duration))):null;
  try{observer?.observe({type:'longtask',buffered:false});}catch{}
  let proof;
  try{
    for(let round=0;round<4;round++)for(const kind of round%2?['rust','javascript']:['javascript','rust']){
      const before=window.paletteStats.jobs,at=performance.now();
      // Each call decodes the URL using the real public API, including raster,
      // sliced scheduling, all masks, optional preview JPEGs and cleanup.
      const value=await (kind==='rust'?production:original).analyzeCoverRelief(url,{previews});
      const elapsed=performance.now()-at,actual=JSON.stringify(semantic(value));
      if(proof===undefined)proof=actual;else if(actual!==proof)throw new Error('Complete browser cover result changed');
      const calls=window.paletteStats.jobs-before;if(calls!==(kind==='rust'?1:0))throw new Error('Cover palette route not used');
      details.push({round,kind,elapsed,analysis:value.analysis,calls});if(round)samples[kind].push(elapsed);
      await pause();
    }
    return {name,previews,sourceSha256:await hash(await blob.arrayBuffer()),artifact:await artifact(),samples,details,longTasks,
      javascriptMedianMs:median(samples.javascript),rustMedianMs:median(samples.rust),proof:JSON.parse(proof),stats:{...window.paletteStats}};
  }finally{observer?.disconnect();URL.revokeObjectURL(url);}
};window.paletteReady=true;
</script>`;
let vite,http,url;
test.beforeAll(async()=>{
  vite=await createServer({configFile:false,root:process.cwd(),base:'/inhouse-read/',
    optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true,hmr:false,watch:null},
    plugins:[{name:'palette-fixture',configureServer(server){server.middlewares.use(async(request,response,next)=>{
      if(request.url?.split('?')[0]!=='/inhouse-read/__palette')return next();
      try{response.setHeader('Content-Type','text/html');response.end(await server.transformIndexHtml('/inhouse-read/__palette',html));}catch(error){next(error);}
    });}}]});
  http=createHttpServer(vite.middlewares);await new Promise(resolve=>http.listen(0,'127.0.0.1',resolve));
  url='http://127.0.0.1:'+http.address().port+'/inhouse-read/__palette';
});
test.afterAll(async()=>{http?.closeAllConnections();if(http)await new Promise(resolve=>http.close(resolve));await vite?.close();});
test.use({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});
test.beforeEach(async({page})=>{
  await page.addInitScript(()=>{
    window.paletteStats={jobs:0,liveJobs:0,releases:0};
    const observe=result=>{
      const instance=result.instance||result,actual=instance.exports;if(!actual?.relief_analysis_new)return result;
      // Only the analysis jobs are the palette route (the map jobs of the previews share the free export).
      const stats=window.paletteStats,analysis=new Set(),exports={...actual,
        relief_analysis_new(...args){const p=actual.relief_analysis_new(...args);if(p){analysis.add(p);stats.jobs++;stats.liveJobs++;}return p;},
        relief_job_free(p){actual.relief_job_free(p);if(analysis.delete(p)){stats.releases++;stats.liveJobs--;}}};
      const wrapped=new Proxy(instance,{get(target,key){return key==='exports'?exports:Reflect.get(target,key,target);}});
      return result.instance?{...result,instance:wrapped}:wrapped;
    };
    for(const name of ['instantiate','instantiateStreaming'])if(typeof WebAssembly[name]==='function'){
      const native=WebAssembly[name];WebAssembly[name]=async function(...args){return observe(await Reflect.apply(native,WebAssembly,args));};
    }
  });
  const session=await page.context().newCDPSession(page);await session.send('Emulation.setCPUThrottlingRate',{rate:4});
});
async function ready(page){await page.goto(url);await page.waitForFunction(()=>window.paletteReady===true);}
for(const input of reliefPaletteCases)test('complete palette and analysis: '+input.name,async({page},testInfo)=>{
  // New timing diagnostic: two pipelines, 2 warmups + 9 samples, CPU x4.
  // Existing reader and native-return deadlines are not altered.
  test.setTimeout(120000);await ready(page);
  const result=await page.evaluate(input=>window.palettePure(input),input);
  expect(result.stats.liveJobs).toBe(0);expect(result.stats.jobs).toBe(result.stats.releases);
  await testInfo.attach('relief-palette-measurement',{body:JSON.stringify(result),contentType:'application/json'});
});
for(const name of ['01-ornate-classic','04-photo','16-cc0-flower-photo','12-tiny-lowres'])for(const previews of [false,true])
test('actual cover API: '+name+' previews='+previews,async({page},testInfo)=>{
  test.setTimeout(120000);await ready(page);
  const result=await page.evaluate(({name,previews})=>window.paletteCover(name,previews),{name,previews});
  expect(result.stats.liveJobs).toBe(0);expect(result.stats.jobs).toBe(result.stats.releases);
  await testInfo.attach('relief-cover-measurement',{body:JSON.stringify(result),contentType:'application/json'});
});
