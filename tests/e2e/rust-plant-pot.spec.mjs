import {test,expect} from '@playwright/test';
import {createServer} from 'vite';
import {createServer as createHttpServer} from 'node:http';
const html=`<!doctype html><script type="module">
import * as THREE from '/inhouse-read/node_modules/three/build/three.module.js';
import {loadRustCore} from '/inhouse-read/src/js/rust-core.js';
import {rustPlantPotSurface} from '/inhouse-read/src/js/plant-pot-wasm.js';
import {createShelfPlant,plantSurfacesReady} from '/inhouse-read/src/js/shelf-plants.js';
import {createShelfPlant as originalModel,plantSurfacesReady as originalReady} from '/inhouse-read/tests/unit/helpers/reference-shelf-plants.js';
import {potGeometry,potProfile} from '/inhouse-read/tests/unit/helpers/reference-plant-pot.js';
const core=await loadRustCore();if(!core?.plant_pot_surface)throw Error('Compiled pots required');
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
function accelerated(potId,outerRadius,height,soil){
 const raw=potProfile(potId),fullHeight=Math.max(...raw.map(([,y])=>y)),profile=raw.map(([r,y])=>[r,y/fullHeight]);
 const radius=outerRadius/(Math.max(...profile.map(([r])=>r))+(potId==='gradvis'?.018:0)),segments=potId==='gradvis'?96:potId==='muskot'?40:48;
 const geometry=new THREE.LatheGeometry(profile.map(([r,y])=>new THREE.Vector2(r*radius,y*height)),segments);
 if(rustPlantPotSurface(core,geometry,potId,profile,segments,radius,height,soil)===null)throw Error('Pot fallback');return geometry;
}
window.checkPots=async()=>{
 for(const pot of ['muskot','gradvis','akerbar','muskotblomma']){
  const entry={catalogId:'monstera',potId:pot,seed:'compiled-pot-'+pot,inspectionResolution:1};
  const actual=createShelfPlant(entry),ref=originalModel(entry);compare(actual,ref);
  await Promise.all([plantSurfacesReady(),originalReady()]);actual.userData.dispose();ref.userData.dispose();
 }
 const actualCalls=window.potStats.calls,results=[];
 for(const pot of ['muskot','gradvis','akerbar','muskotblomma']){
  const times={js:[],rust:[]};const js=()=>potGeometry(pot,60,85,.84).geometry,rust=()=>accelerated(pot,60,85,.84);
  for(let i=0;i<20;i++){js().dispose();rust().dispose();}
  for(let r=0;r<9;r++)for(const kind of r%2?['rust','js']:['js','rust']){
   const start=performance.now();for(let i=0;i<30;i++)(kind==='js'?js:rust)().dispose();times[kind].push((performance.now()-start)/30);
  }
  const median=a=>[...a].sort((a,b)=>a-b)[4];results.push({pot,js:median(times.js),rust:median(times.rust),times});
 }
 return{actualCalls,results,memory:{...window.potStats}};
};
</script>`;
let vite,http,url;
test.beforeAll(async()=>{
 vite=await createServer({configFile:false,root:process.cwd(),base:'/inhouse-read/',optimizeDeps:{noDiscovery:true},server:{middlewareMode:true,hmr:false,watch:null},plugins:[{name:'pot-fixture',configureServer(server){server.middlewares.use(async(req,res,next)=>{
  if(req.url?.split('?')[0]!=='/inhouse-read/__pots')return next();
  try{res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml('/inhouse-read/__pots',html));}catch(e){next(e);}
 });}}]});
 http=createHttpServer(vite.middlewares);await new Promise(r=>http.listen(0,'127.0.0.1',r));url='http://127.0.0.1:'+http.address().port+'/inhouse-read/__pots';
});
test.afterAll(async()=>{http?.closeAllConnections();if(http)await new Promise(r=>http.close(r));await vite?.close();});
test('actual pots keep exact mesh and surface attributes through Rust',async({page},info)=>{
 test.setTimeout(90_000);
 await page.addInitScript(()=>{
  const stats=window.potStats={calls:0,live:0,peak:0};
  for(const name of ['instantiate','instantiateStreaming'])if(WebAssembly[name]){
   const original=WebAssembly[name];WebAssembly[name]=async function(...args){
    const result=await original.apply(WebAssembly,args),instance=result.instance||result,core=instance.exports;if(!core.plant_pot_surface)return result;
    const exports={...core,alloc_f64(n){const p=core.alloc_f64(n);if(p){stats.live+=n*8;stats.peak=Math.max(stats.peak,stats.live);}return p;},free_f64(p,n){stats.live-=n*8;return core.free_f64(p,n);},
     plant_pot_surface(...args){stats.calls++;return core.plant_pot_surface(...args);}};
    return result.instance?{...result,instance:{exports}}:{exports};
   };
  }
 });
 await page.setViewportSize({width:390,height:844});const cdp=await page.context().newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
 await page.goto(url);await page.waitForFunction(()=>window.checkPots);const result=await page.evaluate(()=>window.checkPots());
 expect(result.actualCalls).toBe(4);expect(result.memory.live).toBe(0);
 await info.attach('actual-pots-and-timing',{body:JSON.stringify(result),contentType:'application/json'});console.log(JSON.stringify(result));
});
