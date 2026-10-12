import {test,expect} from '@playwright/test';
import {createServer} from 'vite';
import {createServer as createHttpServer} from 'node:http';
const html=`<!doctype html><script type="module">
import {loadRustCore} from '/inhouse-read/src/js/rust-core.js';
import {createShelfPlant,plantSurfacesReady} from '/inhouse-read/src/js/shelf-plants.js';
import {createShelfPlant as originalModel,plantSurfacesReady as originalReady} from '/inhouse-read/tests/unit/helpers/reference-shelf-plants.js';
const core=await loadRustCore();if(!core?.plant_monstera_mesh)throw Error('Compiled monstera required');
const bytes=a=>new Uint8Array(a.buffer,a.byteOffset,a.byteLength);
function compare(a,b){
 const left=[],right=[];a.traverse(o=>{if(o.geometry)left.push(o.geometry)});b.traverse(o=>{if(o.geometry)right.push(o.geometry)});
 if(left.length!==right.length)throw Error('Model size differs');
 for(let i=0;i<left.length;i++)for(const name of [...Object.keys(right[i].attributes),'index']){
  const x=name==='index'?left[i].index:left[i].attributes[name],y=name==='index'?right[i].index:right[i].attributes[name];
  if(!x&&!y)continue;if(!x||!y)throw Error('Missing attribute');
  const actual=bytes(x.array),expected=bytes(y.array);
  if(x.constructor.name!==y.constructor.name||x.version!==y.version||actual.length!==expected.length||actual.some((v,j)=>v!==expected[j]))throw Error('Pot '+name+' differs');
 }
}

window.checkMonstera=async()=>{
 const entry={catalogId:'monstera',potId:'gradvis',seed:'compiled-monstera',inspectionResolution:1};
 const actual=createShelfPlant(entry),ref=originalModel(entry);compare(actual,ref);
 await Promise.all([plantSurfacesReady(),originalReady()]);actual.userData.dispose();ref.userData.dispose();
 const actualCalls=window.monsteraStats.calls,times={js:[],rust:[]};
 const run=kind=>{window.monsteraEnabled=kind==='rust';const model=createShelfPlant(entry);model.userData.dispose();};
 // Both routes use every already-migrated kernel. Only this extrusion kernel
 // is disabled for the JS baseline, before allocation, by the export getter.
 for(let i=0;i<10;i++){run('js');run('rust');}
 await plantSurfacesReady();const capacityBefore=core.memory.buffer.byteLength;
 for(let r=0;r<9;r++)for(const kind of r%2?['rust','js']:['js','rust']){
  const start=performance.now();for(let i=0;i<5;i++)run(kind);times[kind].push((performance.now()-start)/5);
 }
 await plantSurfacesReady();window.monsteraEnabled=true;
 const median=a=>[...a].sort((a,b)=>a-b)[4];return{actualCalls,js:median(times.js),rust:median(times.rust),times,memory:{...window.monsteraStats},capacityBefore,capacityAfter:core.memory.buffer.byteLength};
};
</script>`;
let vite,http,url;
test.beforeAll(async()=>{
 vite=await createServer({configFile:false,root:process.cwd(),base:'/inhouse-read/',optimizeDeps:{noDiscovery:true},server:{middlewareMode:true,hmr:false,watch:null},plugins:[{name:'monstera-fixture',configureServer(server){server.middlewares.use(async(req,res,next)=>{
  if(req.url?.split('?')[0]!=='/inhouse-read/__monstera')return next();
  try{res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml('/inhouse-read/__monstera',html));}catch(e){next(e);}
 });}}]});
 http=createHttpServer(vite.middlewares);await new Promise(r=>http.listen(0,'127.0.0.1',r));url='http://127.0.0.1:'+http.address().port+'/inhouse-read/__monstera';
});
test.afterAll(async()=>{http?.closeAllConnections();if(http)await new Promise(r=>http.close(r));await vite?.close();});
test('actual monstera keeps holes and every attribute through Rust extrusion',async({page},info)=>{
 test.setTimeout(90_000);
 await page.addInitScript(()=>{
  const stats=window.monsteraStats={calls:0,live:0,peak:0};
  for(const name of ['instantiate','instantiateStreaming'])if(WebAssembly[name]){
   const original=WebAssembly[name];WebAssembly[name]=async function(...args){
    const result=await original.apply(WebAssembly,args),instance=result.instance||result,core=instance.exports;if(!core.plant_monstera_mesh)return result;
    const exports={...core,alloc_f64(n){const p=core.alloc_f64(n);if(p){stats.live+=n*8;stats.peak=Math.max(stats.peak,stats.live);}return p;},free_f64(p,n){stats.live-=n*8;return core.free_f64(p,n);},
     };
    const kernel=(...args)=>{stats.calls++;return core.plant_monstera_mesh(...args);};
    Object.defineProperty(exports,'plant_monstera_mesh',{get:()=>window.monsteraEnabled!==false?kernel:undefined});
    return result.instance?{...result,instance:{exports}}:{exports};
   };
  }
 });
 await page.setViewportSize({width:390,height:844});const cdp=await page.context().newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
 await page.goto(url);await page.waitForFunction(()=>window.checkMonstera);const result=await page.evaluate(()=>window.checkMonstera());
 expect(result.actualCalls).toBeGreaterThan(0);expect(result.capacityAfter).toBe(result.capacityBefore);expect(result.memory.live).toBe(0);
 await info.attach('actual-monstera-and-timing',{body:JSON.stringify(result),contentType:'application/json'});console.log(JSON.stringify(result));
});
