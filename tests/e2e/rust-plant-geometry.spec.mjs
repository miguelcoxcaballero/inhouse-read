import {expect,test} from '@playwright/test';
import {createServer} from 'vite';
import {createServer as createHttpServer} from 'node:http';
import {plantModelCases,expectedPlantLeafCalls} from '../helpers/plant-leaf-cases.mjs';
const html=`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><script type="module">
import {loadRustCore} from '/inhouse-read/src/js/rust-core.js';
import coreUrl from '/inhouse-read/src/wasm/inhouse_read_core.wasm?url';
import {createShelfPlant as candidate,plantSurfacesReady as candidateReady} from '/inhouse-read/src/js/shelf-plants.js';
import {createShelfPlant as original,plantSurfacesReady as originalReady} from '/inhouse-read/tests/unit/helpers/reference-shelf-plants.js';
import {benchmarkPlantModel} from '/inhouse-read/tests/helpers/plant-geometry-benchmark.mjs';
const core=await loadRustCore();if(!core?.plant_leaf_mesh)throw new Error('Actual compiled plant geometry core required');
window.benchmarkPlant=async ({entry,expectedCalls})=>{
  const result=await benchmarkPlantModel({original,candidate,originalReady,candidateReady,entry,expectedCalls,stats:window.plantStats});
  const response=await fetch(coreUrl);if(!response.ok)throw new Error('Actual WASM HTTP failed');const bytes=await response.arrayBuffer();
  const digest=await crypto.subtle.digest('SHA-256',bytes);
  return {...result,artifact:{bytes:bytes.byteLength,sha256:[...new Uint8Array(digest)].map(n=>n.toString(16).padStart(2,'0')).join('')}};
};window.plantBenchmarkReady=true;
</script>`;
let vite,http,url;
test.beforeAll(async()=>{
  // Only the source modules and Three are served. No full application/CSS
  // graph or repository watcher runs in this benchmark worker.
  vite=await createServer({configFile:false,root:process.cwd(),base:'/inhouse-read/',
    optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true,hmr:false,watch:null},
    plugins:[{name:'plant-geometry-fixture',configureServer(server){server.middlewares.use(async(request,response,next)=>{
      if(request.url?.split('?')[0]!=='/inhouse-read/__plant-geometry')return next();
      try{const content=await server.transformIndexHtml('/inhouse-read/__plant-geometry',html);
        response.statusCode=200;response.setHeader('Content-Type','text/html');response.end(content);
      }catch(error){next(error);}
    });}}]});
  http=createHttpServer(vite.middlewares);await new Promise(resolve=>http.listen(0,'127.0.0.1',resolve));
  url='http://127.0.0.1:'+http.address().port+'/inhouse-read/__plant-geometry';
});
test.afterAll(async()=>{http?.closeAllConnections();if(http)await new Promise(resolve=>http.close(resolve));await vite?.close();});
test.use({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});
test.beforeEach(async({page})=>{
  await page.addInitScript(()=>{
    window.plantStats={calls:0,allocations:0,releases:0,live:0,peak:0};
    const observe=result=>{
      const instance=result.instance||result,actual=instance.exports;if(typeof actual?.plant_leaf_mesh!=='function')return result;
      const stats=window.plantStats,exports={...actual,
        alloc_f64(n){const p=actual.alloc_f64(n);if(p){stats.allocations++;stats.live+=n*8;stats.peak=Math.max(stats.peak,stats.live);}return p;},
        free_f64(p,n){stats.releases++;stats.live-=n*8;actual.free_f64(p,n);},
        plant_leaf_mesh(...args){stats.calls++;return actual.plant_leaf_mesh(...args);}};
      const wrapped=new Proxy(instance,{get(target,key){return key==='exports'?exports:Reflect.get(target,key,target);}});
      return result.instance?{...result,instance:wrapped}:wrapped;
    };
    for(const name of ['instantiate','instantiateStreaming'])if(typeof WebAssembly[name]==='function'){
      const native=WebAssembly[name];WebAssembly[name]=async function(...args){return observe(await Reflect.apply(native,WebAssembly,args));};
    }
  });
  const session=await page.context().newCDPSession(page);await session.send('Emulation.setCPUThrottlingRate',{rate:4});
});
for(const entry of plantModelCases)test(`complete plant build parity and cost: ${entry.catalogId}`,async({page},testInfo)=>{
  // A new complete-model benchmark includes surface painting and repeated
  // 666-leaf models at CPU x4. It does not change any existing test deadline.
  test.setTimeout(120_000);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(url);await page.waitForFunction(()=>window.plantBenchmarkReady===true);
  const expectedCalls=expectedPlantLeafCalls[entry.catalogId];
  const result=await page.evaluate(input=>window.benchmarkPlant(input),{entry,expectedCalls});
  expect(result.coldFirstSpeciesInSession.calls.rust).toBe(expectedCalls);
  expect(result.memory.live).toBe(0);expect(result.memory.allocations).toBe(result.memory.releases);
  expect(result.baked.rustCalls).toBe(0);expect(errors).toEqual([]);
  await testInfo.attach('plant-geometry-measurement',{body:JSON.stringify(result,null,2),contentType:'application/json'});
});
