import { expect, test } from '@playwright/test';
import { createServer } from 'vite';
import { createServer as createHttpServer } from 'node:http';

const html=`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><script type="module">
import {loadRustCore} from '/inhouse-read/src/js/rust-core.js';
import coreUrl from '/inhouse-read/src/wasm/inhouse_read_core.wasm?url';
import {rustPrepareSpeech} from '/inhouse-read/src/js/readers/neural-voice/pcm-wasm.js';
import {prepareSpeech} from '/inhouse-read/src/js/readers/neural-voice/pcm.js';
import {peakNormalize,trimSilence,fadeEdges} from '/inhouse-read/tests/unit/helpers/reference-pcm.js';
import {pcmCases,makePCM} from '/inhouse-read/tests/helpers/pcm-cases.mjs';
const core=await loadRustCore();
if(typeof core?.pcm_prepare!=='function')throw Error('Actual compiled PCM kernel required');
const hash=async array=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(array.buffer,array.byteOffset,array.byteLength))),n=>n.toString(16).padStart(2,'0')).join('');
const equal=(a,b)=>{if(a!==b)throw Error('PCM byte parity mismatch');};
window.measurePCM=async name=>{
  const input=pcmCases.find(c=>c.name===name),rate=input.rate||22050,raw=makePCM(input);
  const js=()=>{const a=raw.slice();peakNormalize(a,{model:input.model});return {raw:a,speech:fadeEdges(trimSilence(a,rate),rate)};};
  const rust=()=>{const a=raw.slice();return {raw:a,speech:prepareSpeech(a,rate,{model:input.model})};};
  const expected=js(),actual=rust();
  equal(await hash(expected.speech),await hash(actual.speech));equal(await hash(actual.raw),await hash(raw));
  let calls=0,live=0,peak=0,allocations=0,releases=0;
  const tracked={...core,alloc_f64(n){const p=core.alloc_f64(n);if(p){allocations++;live+=n*8;peak=Math.max(peak,live);}return p;},
    free_f64(p,n){core.free_f64(p,n);live-=n*8;releases++;},pcm_prepare(...args){calls++;return core.pcm_prepare(...args);}};
  const observed=rustPrepareSpeech(tracked,raw.slice(),rate,input.model);
  equal(await hash(observed),await hash(expected.speech));equal(calls,1);equal(live,0);equal(allocations,releases);
  if(observed.buffer===core.memory.buffer)throw Error('Arena escaped');
  const repetitions=12,rounds=9,warmups=3,samples={javascript:[],rust:[]},orders=[];
  const run=fn=>{let sum=0;for(let i=0;i<repetitions;i++){const r=fn();sum+=r.speech.length+(r.speech[r.speech.length>>1]||0);}return sum;};
  const checksum=run(js),pause=()=>new Promise(resolve=>setTimeout(resolve,0));
  for(let i=0;i<warmups;i++){equal(run(js),checksum);equal(run(rust),checksum);await pause();}
  for(let i=0;i<rounds;i++){
    const order=i%2?['rust','javascript']:['javascript','rust'];orders.push(order);
    for(const kind of order){const start=performance.now();equal(run(kind==='rust'?rust:js),checksum);samples[kind].push(performance.now()-start);await pause();}
  }
  const response=await fetch(coreUrl);if(!response.ok)throw Error('Missing WASM');const bytes=new Uint8Array(await response.arrayBuffer());
  const median=a=>[...a].sort((a,b)=>a-b)[Math.floor(a.length/2)]/repetitions;
  return {input,samples,orders,methodology:{repetitions,rounds,warmups,includes:'input copy, arena allocation, validation, all kernel passes, output copy and release'},
    javascriptMs:median(samples.javascript),rustMs:median(samples.rust),
    hashes:{raw:await hash(actual.raw),speech:await hash(actual.speech)},speechSamples:actual.speech.length,
    memory:{calls,live,peak,allocations,releases},artifact:{bytes:bytes.length,sha256:await hash(bytes)}};
};
window.pcmReady=true;
</script>`;
let vite,http,url;
test.beforeAll(async()=>{
  vite=await createServer({configFile:false,root:process.cwd(),base:'/inhouse-read/',
    optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true,hmr:false,watch:null},
    plugins:[{name:'pcm-fixture',configureServer(server){server.middlewares.use(async(req,res,next)=>{
      if(req.url?.split('?')[0]!=='/inhouse-read/__pcm')return next();
      try{res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml('/inhouse-read/__pcm',html));}catch(error){next(error);}
    });}}]});
  http=createHttpServer(vite.middlewares);await new Promise(resolve=>http.listen(0,'127.0.0.1',resolve));
  url='http://127.0.0.1:'+http.address().port+'/inhouse-read/__pcm';
});
test.afterAll(async()=>{http?.closeAllConnections();if(http)await new Promise(resolve=>http.close(resolve));await vite?.close();});
test.use({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});
for(const name of ['at cutoff','NVCC speech','Piper 5 seconds','Supertonic 12 seconds','long fragment'])
test('identical PCM and bounded allocations, mobile CPU x4: '+name,async({page,context},info)=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const cdp=await context.newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
  await page.goto(url);await page.waitForFunction(()=>window.pcmReady===true);
  const result=await page.evaluate(name=>window.measurePCM(name),name);
  expect(errors).toEqual([]);expect(result.memory.live).toBe(0);expect(result.memory.calls).toBe(1);
  await info.attach('pcm-measurement',{body:JSON.stringify(result),contentType:'application/json'});
  console.log(JSON.stringify({name,javascriptMs:result.javascriptMs,rustMs:result.rustMs}));
});
