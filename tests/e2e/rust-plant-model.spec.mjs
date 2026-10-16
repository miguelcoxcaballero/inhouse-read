import {test,expect} from '@playwright/test';
import {createServer} from 'vite';
import {createServer as createHttpServer} from 'node:http';
// Real Chromium: the Rust shelf module draws the plants (pot, foliage, soil, merged by material and fitted to the envelope)
// with the browser's own Math. Each baked scene is compared, byte for byte and number for number, with the frozen JavaScript
// original built from three.js, and both are timed (cold first plant, then repeated plants, alternating).
const html=`<!doctype html><script type="module">
import {loadRustShelf} from '/inhouse-read/src/js/rust-shelf.js';
import {createShelfPlant,shelfPlantBakeRecord} from '/inhouse-read/src/js/shelf-plants.js';
import {createShelfPlant as reference,shelfPlantBakeRecord as referenceRecord} from '/inhouse-read/tests/unit/helpers/reference-shelf-plants.js';
const shelf=await loadRustShelf();if(!shelf?.plant_model)throw Error('Actual shelf module with the plant model required');
const type=value=>Object.prototype.toString.call(value).slice(8,-1);
let compared=0;
function same(actual,expected,path){
 if(ArrayBuffer.isView(expected)){
  if(type(actual)!==type(expected)||actual.length!==expected.length)throw Error(path+' differs in type or length');
  const a=new Uint8Array(actual.buffer,actual.byteOffset,actual.byteLength),b=new Uint8Array(expected.buffer,expected.byteOffset,expected.byteLength);
  for(let i=0;i<a.length;i++)if(a[i]!==b[i])throw Error(path+' byte '+i);
  compared+=a.length;return;
 }
 if(Array.isArray(expected)){if(!Array.isArray(actual)||actual.length!==expected.length)throw Error(path+' length');expected.forEach((v,i)=>same(actual[i],v,path+'['+i+']'));return;}
 if(expected&&typeof expected==='object'){
  const keys=Object.keys(expected).sort();if(Object.keys(actual).sort().join()!==keys.join())throw Error(path+' keys');
  for(const key of keys)same(actual[key],expected[key],path+'.'+key);return;
 }
 if(!Object.is(actual,expected))throw Error(path+': '+actual+' / '+expected);
}
window.checkPlants=()=>{
 const entries=[['monstera','gradvis'],['sansevieria','muskot'],['chamaedorea','muskotblomma'],['nephrolepis','akerbar'],['hedera','muskot'],['zamioculcas','gradvis'],['succulent','muskot'],['cactus','akerbar']];
 let counter=0;
 const make=([catalogId,potId])=>({catalogId,potId,seed:'chromium-'+catalogId+':'+counter++,height:200});
 // Cold: the first plant of each implementation.
 let start=performance.now();const first=createShelfPlant(make(entries[0]));const coldRust=performance.now()-start;first.userData.dispose();
 start=performance.now();const second=reference(make(entries[0]));const coldJs=performance.now()-start;second.userData.dispose();
 for(const entry of entries){
  const given=make(entry),a=createShelfPlant(given,{persist:true}),b=reference(given,{persist:true});
  try{
   const [key,bake,surfaces]=shelfPlantBakeRecord().models.at(-1),[otherKey,otherBake,otherSurfaces]=referenceRecord().models.at(-1);
   if(key!==otherKey||[...surfaces].join()!==[...otherSurfaces].join())throw Error('Bake keys differ for '+entry);
   same(bake,otherBake,entry[0]+'/'+entry[1]);
  }finally{a.userData.dispose();b.userData.dispose();}
 }
 const run=(kind,entry)=>{const plant=(kind==='rust'?createShelfPlant:reference)(make(entry));plant.userData.dispose();};
 const results=[];
 for(const entry of entries){
  for(let i=0;i<2;i++){run('rust',entry);run('js',entry);}
  const timings={js:[],rust:[]};
  for(let round=0;round<7;round++)for(const kind of round%2?['rust','js']:['js','rust']){const t=performance.now();for(let i=0;i<3;i++)run(kind,entry);timings[kind].push((performance.now()-t)/3);}
  const median=a=>[...a].sort((x,y)=>x-y)[3];
  results.push({plant:entry[0],pot:entry[1],js:median(timings.js),rust:median(timings.rust)});
 }
 return{compared,coldRust,coldJs,results,handles:shelf.shelf_live_handles()};
};
</script>`;
let vite,http,url;
test.beforeAll(async()=>{
 vite=await createServer({configFile:false,root:process.cwd(),base:'/inhouse-read/',optimizeDeps:{noDiscovery:true},server:{middlewareMode:true,hmr:false,watch:null},plugins:[{name:'plant-model-fixture',configureServer(server){server.middlewares.use(async(req,res,next)=>{
  if(req.url?.split('?')[0]!=='/inhouse-read/__plant-model')return next();
  try{res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml('/inhouse-read/__plant-model',html));}catch(e){next(e);}
 });}}]});
 http=createHttpServer(vite.middlewares);await new Promise(r=>http.listen(0,'127.0.0.1',r));url='http://127.0.0.1:'+http.address().port+'/inhouse-read/__plant-model';
});
test.afterAll(async()=>{http?.closeAllConnections();if(http)await new Promise(r=>http.close(r));await vite?.close();});
test('the plants built by the Rust shelf module are byte-identical to the three.js original',async({page},testInfo)=>{
 test.setTimeout(240_000);const cdp=await page.context().newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
 await page.goto(url);await page.waitForFunction(()=>typeof window.checkPlants==='function');
 const result=await page.evaluate(()=>window.checkPlants());
 expect(result.compared).toBeGreaterThan(1_000_000);expect(result.results).toHaveLength(8);
 console.log(JSON.stringify(result));await testInfo.attach('plants',{body:JSON.stringify(result,null,2),contentType:'application/json'});
});
