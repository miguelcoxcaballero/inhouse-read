import { expect, test } from '@playwright/test';
import { createServer } from 'vite';
import { createServer as createHttpServer } from 'node:http';
import { coverColorCases } from '../helpers/cover-color-cases.mjs';

const html = `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><script type="module">
import { loadRustCore } from '/inhouse-read/src/js/rust-core.js';
import coreUrl from '/inhouse-read/src/wasm/inhouse_read_core.wasm?url';
import { rustDominantCoverRgb } from '/inhouse-read/src/js/cover-color-wasm.js';
import { referenceDominantRgb } from '/inhouse-read/tests/unit/helpers/reference-cover-color.js';
import { createCoverColorPixels } from '/inhouse-read/tests/helpers/cover-color-cases.mjs';
const core = await loadRustCore();
if (!core?.cover_dominant_rgb) throw new Error('Actual compiled cover clustering required');
const hash = async data => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data)),
  n=>n.toString(16).padStart(2,'0')).join('');
const equal = (a,b) => { if (JSON.stringify(a)!==JSON.stringify(b)) throw new Error('Cover clustering parity changed'); };
window.observeCoverColor = async input => {
  const data = createCoverColorPixels(input), expected = referenceDominantRgb(data,input.width,input.height);
  const js = () => referenceDominantRgb(data,input.width,input.height);
  const rust = () => rustDominantCoverRgb(core,data,input.width,input.height);
  equal(rust(),expected);
  let calls=0,live=0,peak=0,allocations=0,releases=0;
  const tracked={...core,
    alloc_f64(n){const p=core.alloc_f64(n);if(p){live+=n*8;peak=Math.max(peak,live);allocations++;}return p;},
    free_f64(p,n){core.free_f64(p,n);live-=n*8;releases++;},
    cover_dominant_rgb(...args){calls++;return core.cover_dominant_rgb(...args);}};
  equal(rustDominantCoverRgb(tracked,data,input.width,input.height),expected);
  const required=input.kind==='alpha'?0:1;
  if(calls!==required || live!==0 || allocations!==required || releases!==required)throw new Error('Exact Rust execution/empty shortcut and release required');
  const repetitions=16,warmups=3,rounds=10,samples={javascript:[],rust:[]},orders=[];
  const run=build=>{let sum=0;for(let i=0;i<repetitions;i++){const rgb=build();sum+=rgb[0]+rgb[1]*256+rgb[2]*65536;}return sum;};
  const checksum=run(js),pause=()=>new Promise(resolve=>setTimeout(resolve,0));
  for(let i=0;i<warmups;i++){equal(run(js),checksum);equal(run(rust),checksum);await pause();}
  for(let round=0;round<rounds;round++) {
    const order=round%2?['rust','javascript']:['javascript','rust'];orders.push(order);
    for(const kind of order){const start=performance.now(),sum=run(kind==='rust'?rust:js);samples[kind].push(performance.now()-start);equal(sum,checksum);await pause();}
  }
  equal(rust(),expected);
  const response=await fetch(coreUrl);if(!response.ok)throw new Error('WASM response failed');
  const bytes=new Uint8Array(await response.arrayBuffer());
  const median=values=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];
  return {input,execution:required?'rust':'host-empty-sample',inputSha256:await hash(data),rgb:expected,artifact:{bytes:bytes.length,sha256:await hash(bytes)},samples,orders,
    methodology:{repetitions,warmups,rounds},javascriptPerCoverMedianMs:median(samples.javascript)/repetitions,
    rustPerCoverMedianMs:median(samples.rust)/repetitions,
    memory:{calls,liveArenaBytes:live,peakLiveArenaBytes:peak,allocations,releases,wasmCapacityBytes:core.memory.buffer.byteLength}};
};
window.coverColorReady=true;
</script>`;
let vite, http, url;
test.beforeAll(async () => {
  vite = await createServer({ configFile:false, root:process.cwd(), base:'/inhouse-read/',
    optimizeDeps:{ noDiscovery:true, include:[] }, server:{ middlewareMode:true, hmr:false, watch:null },
    plugins:[{ name:'cover-color-fixture', configureServer(server) { server.middlewares.use(async(request,response,next) => {
      if(request.url?.split('?')[0]!=='/inhouse-read/__cover-color') return next();
      try { const content=await server.transformIndexHtml('/inhouse-read/__cover-color',html);
        response.statusCode=200;response.setHeader('Content-Type','text/html');response.end(content);
      } catch(error) { next(error); }
    }); } }] });
  http=createHttpServer(vite.middlewares);await new Promise(resolve=>http.listen(0,'127.0.0.1',resolve));
  url='http://127.0.0.1:'+http.address().port+'/inhouse-read/__cover-color';
});
test.afterAll(async()=>{http?.closeAllConnections();if(http)await new Promise(resolve=>http.close(resolve));await vite?.close();});
test.use({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});
for(const input of coverColorCases)test(`Rust cover colors keep exact ${input.name} at mobile viewport and CPU x4`,async({page,context},info)=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const cdp=await context.newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
  await page.goto(url);await page.waitForFunction(()=>window.coverColorReady);
  const result=await page.evaluate(input=>window.observeCoverColor(input),input);
  await info.attach('rust-cover-color-observation.json',{contentType:'application/json',body:Buffer.from(JSON.stringify({
    scope:'Desktop Chromium CPU x4, synthetic pixels; includes row sampling, all copies, arena allocation/free and rounding. The marked empty sample runs its host shortcut without Rust. No image decoding, GPU, physical phone or whole-app measurement.',
    ...result},null,2))});
  expect(errors).toEqual([]);expect(result.rgb).toHaveLength(3);expect(result.memory.calls).toBe(input.kind==='alpha'?0:1);
  expect(result.execution).toBe(input.kind==='alpha'?'host-empty-sample':'rust');
  expect(result.memory.liveArenaBytes).toBe(0);expect(result.memory.allocations).toBe(result.memory.releases);
  for(const samples of Object.values(result.samples)){expect(samples).toHaveLength(10);expect(samples.every(n=>Number.isFinite(n)&&n>=0)).toBe(true);}
});
