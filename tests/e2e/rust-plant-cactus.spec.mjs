import {test,expect} from '@playwright/test';
import {createServer} from 'vite';
import {createServer as createHttpServer} from 'node:http';
const html=`<!doctype html><script type="module">
import {loadRustDecorCore} from '/inhouse-read/src/js/rust-decor-core.js';
import {rustPlantCactusGeometry} from '/inhouse-read/src/js/plant-cactus-wasm.js';
import {createShelfPlant,plantSurfacesReady} from '/inhouse-read/src/js/shelf-plants.js';
import {cactusGeometry} from '/inhouse-read/tests/unit/helpers/reference-plant-cactus.js';
const core=await loadRustDecorCore();if(!core?.plant_cactus_mesh)throw Error('Compiled cactus required');
const bytes=a=>new Uint8Array(a.buffer,a.byteOffset,a.byteLength);
window.verifyCactus=(length,radius,bend,samples,actual)=>{
 let at=0;const ref=cactusGeometry(length,radius,bend,()=>samples[at++]);
 try{for(const name of ['position','normal','color','uv','index']){
  const expected=bytes(name==='index'?ref.index.array:ref.attributes[name].array),array=actual[name];
  if(array.length!==expected.length||array.some((v,i)=>v!==expected[i]))throw Error('Cactus '+name+' bytes differ');
 }}finally{ref.dispose();}
};
function random(){let state=981726;return()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};}
window.checkCactus=async()=>{
 const model=createShelfPlant({catalogId:'cactus',potId:'akerbar',seed:'compiled-cactus',height:240,inspectionResolution:1});
 await plantSurfacesReady();model.userData.dispose();const actualCalls=window.cactusStats.calls;window.cactusStats.compare=false;
 const times={js:[],rust:[]},length=150,radius=18,bend=-17;
 const js=()=>cactusGeometry(length,radius,bend,random());
 const rust=()=>{const rng=random();const geometry=rustPlantCactusGeometry(core,{length,radius,bend,samples:Float64Array.from({length:627},()=>rng())});if(!geometry)throw Error('Cactus fallback');return geometry;};
 for(let i=0;i<20;i++){js().dispose();rust().dispose();}
 for(let r=0;r<9;r++)for(const kind of r%2?['rust','js']:['js','rust']){const start=performance.now();for(let i=0;i<40;i++)(kind==='js'?js:rust)().dispose();times[kind].push((performance.now()-start)/40);}
 const median=a=>[...a].sort((a,b)=>a-b)[4];return{actualCalls,js:median(times.js),rust:median(times.rust),times,memory:{...window.cactusStats}};
};
</script>`;
let vite,http,url;
test.beforeAll(async()=>{
 vite=await createServer({configFile:false,root:process.cwd(),base:'/inhouse-read/',optimizeDeps:{noDiscovery:true},server:{middlewareMode:true,hmr:false,watch:null},plugins:[{name:'cactus-fixture',configureServer(server){server.middlewares.use(async(req,res,next)=>{
  if(req.url?.split('?')[0]!=='/inhouse-read/__cactus')return next();
  try{res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml('/inhouse-read/__cactus',html));}catch(e){next(e);}
 });}}]});
 http=createHttpServer(vite.middlewares);await new Promise(r=>http.listen(0,'127.0.0.1',r));url='http://127.0.0.1:'+http.address().port+'/inhouse-read/__cactus';
});
test.afterAll(async()=>{http?.closeAllConnections();if(http)await new Promise(r=>http.close(r));await vite?.close();});
test('actual cactus uses Rust geometry with exact attributes and retained random sequence',async({page},info)=>{
 test.setTimeout(90_000);
 await page.addInitScript(()=>{
  const stats=window.cactusStats={calls:0,live:0,peak:0,compare:true,verified:0,mismatches:0};
  for(const name of ['instantiate','instantiateStreaming'])if(WebAssembly[name]){
   const original=WebAssembly[name];WebAssembly[name]=async function(...args){
    const result=await original.apply(WebAssembly,args),instance=result.instance||result,core=instance.exports;if(!core.plant_cactus_mesh)return result;
    const exports={...core,alloc_f64(n){const p=core.alloc_f64(n);if(p){stats.live+=n*8;stats.peak=Math.max(stats.peak,stats.live);}return p;},free_f64(p,n){stats.live-=n*8;return core.free_f64(p,n);},
     plant_cactus_mesh(length,radius,bend,columns,samples,position,normal,color,uv,index){
      stats.calls++;const values=stats.compare?new Float64Array(core.memory.buffer,samples,627).slice():null;
      const count=core.plant_cactus_mesh(length,radius,bend,columns,samples,position,normal,color,uv,index);
      if(stats.compare&&count===3456){try{
       const data={position:new Uint8Array(core.memory.buffer,position,1881*4),normal:new Uint8Array(core.memory.buffer,normal,1881*4),color:new Uint8Array(core.memory.buffer,color,1881*4),uv:new Uint8Array(core.memory.buffer,uv,1254*4),index:new Uint8Array(core.memory.buffer,index,3456*2)};
       window.verifyCactus(length,radius,bend,values,data);stats.verified++;
      }catch(e){stats.mismatches++;throw e;}}
      return count;
     }};
    return result.instance?{...result,instance:{exports}}:{exports};
   };
  }
 });
 await page.setViewportSize({width:390,height:844});const cdp=await page.context().newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
 await page.goto(url);await page.waitForFunction(()=>window.checkCactus);const result=await page.evaluate(()=>window.checkCactus());
 expect(result.actualCalls).toBeGreaterThan(0);expect(result.memory.verified).toBe(result.actualCalls);expect(result.memory.mismatches).toBe(0);expect(result.memory.live).toBe(0);
 await info.attach('actual-cactus-and-timing',{body:JSON.stringify(result),contentType:'application/json'});console.log(JSON.stringify(result));
});
