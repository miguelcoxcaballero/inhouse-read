import { expect,test } from '@playwright/test';
import { createServer } from 'vite';
import { createServer as createHttpServer } from 'node:http';
import { shelfSessionCases } from '../helpers/shelf-placement-session-cases.mjs';
const html=`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><script type="module">
import {loadRustCore} from '/inhouse-read/src/js/rust-core.js';
import coreUrl from '/inhouse-read/src/wasm/inhouse_read_core.wasm?url';
import {benchmarkShelfPlacementSession} from '/inhouse-read/tests/helpers/shelf-placement-session-browser-benchmark.mjs';
const core=await loadRustCore();if(!core?.shelf_place)throw new Error('Actual compiled shelf placement core required');
window.benchShelfSession=async input=>{
  const result=await benchmarkShelfPlacementSession(core,input);
  const response=await fetch(coreUrl);if(!response.ok)throw new Error('Actual WASM HTTP failed');const bytes=await response.arrayBuffer();
  const digest=await crypto.subtle.digest('SHA-256',bytes);
  return{...result,artifact:{bytes:bytes.byteLength,sha256:Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,'0')).join('')}};
};window.sessionReady=true;
</script>`;
let vite,http,url;
test.beforeAll(async()=>{
  vite=await createServer({configFile:false,root:process.cwd(),base:'/inhouse-read/',
    optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true,hmr:false,watch:null},
    plugins:[{name:'session-fixture',configureServer(server){server.middlewares.use(async(request,response,next)=>{
      if(request.url?.split('?')[0]!=='/inhouse-read/__placement-session')return next();
      try{const content=await server.transformIndexHtml('/inhouse-read/__placement-session',html);
        response.statusCode=200;response.setHeader('Content-Type','text/html');response.end(content);
      }catch(error){next(error);}
    });}}]});
  http=createHttpServer(vite.middlewares);await new Promise(resolve=>http.listen(0,'127.0.0.1',resolve));
  url='http://127.0.0.1:'+http.address().port+'/inhouse-read/__placement-session';
});
test.afterAll(async()=>{http?.closeAllConnections();if(http)await new Promise(resolve=>http.close(resolve));await vite?.close();});
test.use({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});
test.beforeEach(async({page})=>{
  await page.addInitScript(()=>{
    window.placementStats={live:0,peak:0,allocations:0,releases:0,calls:0};
    const observe=result=>{const instance=result.instance||result,actual=instance.exports;
      if(typeof actual?.shelf_place!=='function')return result;
      const stats=window.placementStats,exports={...actual,
        alloc_f64(n){const pointer=actual.alloc_f64(n);if(pointer){stats.live+=n*8;stats.peak=Math.max(stats.peak,stats.live);stats.allocations++;}return pointer;},
        free_f64(pointer,n){actual.free_f64(pointer,n);stats.live-=n*8;stats.releases++;},
        shelf_place(...args){stats.calls++;return actual.shelf_place(...args);}};
      const observed=new Proxy(instance,{get(target,key){return key==='exports'?exports:Reflect.get(target,key,target);}});
      return result.instance?{...result,instance:observed}:observed;};
    for(const name of ['instantiate','instantiateStreaming'])if(typeof WebAssembly[name]==='function'){
      const native=WebAssembly[name];WebAssembly[name]=async function(...args){return observe(await Reflect.apply(native,WebAssembly,args));};
    }
  });
  const session=await page.context().newCDPSession(page);await session.send('Emulation.setCPUThrottlingRate',{rate:4});
  await page.goto(url);await page.waitForFunction(()=>window.sessionReady===true);
});
for(const input of shelfSessionCases)test(`complete owned drag cost: ${input.name}`,async({page},testInfo)=>{
  // This new benchmark deliberately measures up to 120 complete moves of
  // 1,000 objects across nine rounds at CPU x4, including setup every round.
  test.setTimeout(120_000);
  const result=await page.evaluate(input=>window.benchShelfSession(input),input);
  const expectedCalls=input.count>=16?Math.max(0,input.moves-2):0;
  expect(result.actualCalls).toBe(expectedCalls);expect(result.proofRouting.javascriptBypasses).toBe(input.moves-expectedCalls);
  expect(result.memory.live).toBe(0);
  expect(result.memory.allocations).toBe(result.memory.releases);
  await testInfo.attach('placement-session-measurement',{body:JSON.stringify(result,null,2),contentType:'application/json'});
});
