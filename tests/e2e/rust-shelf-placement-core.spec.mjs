import { expect,test } from '@playwright/test';
import { createServer } from 'vite';
import { createServer as createHttpServer } from 'node:http';
import { placementBenchCases } from '../helpers/shelf-placement-cases.mjs';

const html=`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><script type="module">
import {loadRustCore} from '/inhouse-read/src/js/rust-core.js';
import coreUrl from '/inhouse-read/src/wasm/inhouse_read_core.wasm?url';
import * as production from '/inhouse-read/src/js/shelf-placement.js';
import * as productionDecoration from '/inhouse-read/src/js/shelf-decoration-layout.js';
import {rustShelfPlacement} from '/inhouse-read/src/js/shelf-placement-wasm.js';
import * as original from '/inhouse-read/tests/unit/helpers/reference-shelf-placement.js';
import * as originalDecoration from '/inhouse-read/tests/unit/helpers/reference-shelf-decoration-layout.js';
import {placementFixture,originalPlacement} from '/inhouse-read/tests/helpers/shelf-placement-cases.mjs';
import {targetsFor,placementOptions,canonicalPlacement,placementChecksum} from '/inhouse-read/tests/helpers/shelf-placement-benchmark.mjs';
const core=await loadRustCore();if(!core?.shelf_place)throw new Error('Actual compiled shelf placement kernel required');
const hash=async data=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',typeof data==='string'?new TextEncoder().encode(data):data)),n=>n.toString(16).padStart(2,'0')).join('');
const same=(actual,expected)=>{if(canonicalPlacement(actual)!==canonicalPlacement(expected))throw new Error('Complete placement parity changed');};
const pause=()=>new Promise(resolve=>setTimeout(resolve,0));
const median=values=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];
window.benchPlacement=async input=>{
  const fixture=placementFixture(input),targets=targetsFor(fixture,input),proof=[];
  const publicCallsBefore=window.placementStats.calls;
  same(originalPlacement(production,productionDecoration,fixture,input.api,targets[0]),
    originalPlacement(original,originalDecoration,fixture,input.api,targets[0]));
  const publicCalls=window.placementStats.calls-publicCallsBefore;
  // The public API has no JavaScript twin any more: it must be the compiled kernel, and give the frozen original's result.
  if(publicCalls<1)throw new Error('Public API did not run the compiled kernel');
  const before={...window.placementStats};
  for(const target of targets){
    const expected=originalPlacement(original,originalDecoration,fixture,input.api,target);
    const actual=rustShelfPlacement(core,fixture.objects,fixture.options,placementOptions(fixture,input.api,target));
    same(actual,expected);proof.push({target,sha256:await hash(canonicalPlacement(expected))});
    const shelves=Array.isArray(actual)?actual:actual.shelves;
    for(const shelf of shelves){if(shelf.items!==shelf.objects)throw new Error('Row array identity changed');
      for(const item of shelf.items)if(!fixture.objects.some(object=>object.key===item.key&&object.metadata===item.metadata))throw new Error('Metadata identity changed');}
  }
  const actualCalls=window.placementStats.calls-before.calls;
  if(actualCalls!==targets.length)throw new Error('Direct candidate bridge did not call one actual kernel per placement');
  if(window.placementStats.live!==0||window.placementStats.allocations!==window.placementStats.releases)throw new Error('Placement arena leaked');
  const repetitions=input.sequence?1:input.count>=1000?2:input.count>=200?4:16;
  const rounds=9,warmups=2,samples={javascript:[],rust:[]},orders=[];
  const run=rust=>{let sum=0;for(let n=0;n<repetitions;n++)for(const target of targets){
    sum+=placementChecksum(rust?rustShelfPlacement(core,fixture.objects,fixture.options,placementOptions(fixture,input.api,target))
      :originalPlacement(original,originalDecoration,fixture,input.api,target));
  }return sum;};
  const checksum=run(false);same(run(true),checksum);
  for(let i=0;i<warmups;i++){same(run(false),checksum);same(run(true),checksum);}await pause();
  for(let round=0;round<rounds;round++){
    const order=round%2?['rust','javascript']:['javascript','rust'];orders.push(order);
    for(const kind of order){const begin=performance.now();const actual=run(kind==='rust');samples[kind].push(performance.now()-begin);same(actual,checksum);await pause();}
  }
  const response=await fetch(coreUrl);if(!response.ok)throw new Error('Actual WASM response failed');const bytes=await response.arrayBuffer();
  return {input,proof,publicCalls,directBridgeCalls:actualCalls,inputSha256:await hash(canonicalPlacement(fixture)),artifact:{bytes:bytes.byteLength,sha256:await hash(bytes)},
    methodology:{rounds,warmups,repetitions,placementsPerRepetition:targets.length},samples,orders,
    javascriptPerPlacementMedianMs:median(samples.javascript)/(repetitions*targets.length),
    rustPerPlacementMedianMs:median(samples.rust)/(repetitions*targets.length),
    memory:{...window.placementStats,wasmCapacityBytes:core.memory.buffer.byteLength}};
};
window.placementReady=true;
</script>`;
let vite,http,url;
test.beforeAll(async()=>{
  vite=await createServer({configFile:false,root:process.cwd(),base:'/inhouse-read/',
    optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true,hmr:false,watch:null},
    plugins:[{name:'placement-fixture',configureServer(server){server.middlewares.use(async(request,response,next)=>{
      if(request.url?.split('?')[0]!=='/inhouse-read/__placement')return next();
      try{const content=await server.transformIndexHtml('/inhouse-read/__placement',html);
        response.statusCode=200;response.setHeader('Content-Type','text/html');response.end(content);
      }catch(error){next(error);}
    });}}]});
  http=createHttpServer(vite.middlewares);await new Promise(resolve=>http.listen(0,'127.0.0.1',resolve));
  url='http://127.0.0.1:'+http.address().port+'/inhouse-read/__placement';
});
test.afterAll(async()=>{http?.closeAllConnections();if(http)await new Promise(resolve=>http.close(resolve));await vite?.close();});
test.use({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});
test.beforeEach(async({page})=>{
  await page.addInitScript(()=>{
    window.placementStats={live:0,peak:0,allocations:0,releases:0,calls:0};
    const observe=result=>{const instance=result.instance||result,actual=instance.exports;
      if(typeof actual?.shelf_place!=='function')return result;
      const stats=window.placementStats,exports={...actual,
        alloc_f64(n){const p=actual.alloc_f64(n);if(p){stats.live+=n*8;stats.peak=Math.max(stats.peak,stats.live);stats.allocations++;}return p;},
        free_f64(p,n){actual.free_f64(p,n);stats.live-=n*8;stats.releases++;},
        shelf_place(...args){stats.calls++;return actual.shelf_place(...args);}};
      const observed=new Proxy(instance,{get(target,key){return key==='exports'?exports:Reflect.get(target,key,target);}});
      return result.instance?{...result,instance:observed}:observed;};
    for(const name of ['instantiate','instantiateStreaming'])if(typeof WebAssembly[name]==='function'){
      const native=WebAssembly[name];WebAssembly[name]=async function(...args){return observe(await Reflect.apply(native,WebAssembly,args));};
    }
  });
  const session=await page.context().newCDPSession(page);await session.send('Emulation.setCPUThrottlingRate',{rate:4});
  await page.goto(url);await page.waitForFunction(()=>window.placementReady===true);
});
for(const input of placementBenchCases)test(`complete shelf placement parity and costs: ${input.name}`,async({page},testInfo)=>{
  const result=await page.evaluate(input=>window.benchPlacement(input),input);
  expect(result.publicCalls).toBeGreaterThan(0);expect(result.directBridgeCalls).toBe(input.sequence||1);expect(result.memory.live).toBe(0);
  expect(result.memory.allocations).toBe(result.memory.releases);
  await testInfo.attach('placement-measurement',{body:JSON.stringify(result,null,2),contentType:'application/json'});
});
