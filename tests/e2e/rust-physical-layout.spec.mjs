import {test,expect} from '@playwright/test';
import {createServer} from 'vite';
import {createServer as createHttpServer} from 'node:http';
const html=`<!doctype html><script type="module">
import {loadRustCore} from '/inhouse-read/src/js/rust-core.js';
import {measuredShelfModelLayout as shelfModelLayout} from '/inhouse-read/src/js/shelf-model-layout.js';
import {placeRooftopPlants} from '/inhouse-read/src/js/plant-rooftop-layout.js';
import {shelfModelLayout as reference} from '/inhouse-read/tests/unit/helpers/reference-shelf-model-layout.js';
import {placeRooftopPlants as roofReference} from '/inhouse-read/tests/unit/helpers/reference-plant-rooftop-layout.js';
import {scratchPointer,scratch} from '/inhouse-read/src/js/catalogue-core.js';
const core=await loadRustCore();if(!core?.shelf_model)throw Error('Actual shelf_model required');
const fixture=(count,width,tall=false)=>({width,rows:Array.from({length:Math.ceil(count/6)},()=>({})),entries:Array.from({length:count},(_,i)=>({
kind:['book','plant','lamp'][i%3],shelf:Math.floor(i/6),key:'object-'+i,x:40+(i%6)*48,
height:i%3===1?(tall?350:25):172,width:90,depth:100,style:{heightRatio:.91},mount:i%2?'floor':'undershelf',node:{dataset:{}},book:{title:'Book '+i}}))});
window.checkPhysical=()=>{
 const proof=[],samples=[];
 for(const type of ['baggebo','walnut'])for(const width of [300,393.25,600]) {
  const original=fixture(36,width),expected=roofReference(reference(structuredClone(original),type));
  const before={...window.layoutStats},actual=placeRooftopPlants(shelfModelLayout(original,type));
  if(JSON.stringify(actual)!==JSON.stringify(expected))throw Error('Physical coordinates or roof packing differ');
  if(actual.entries.some((entry,i)=>entry.node!==original.entries[i].node||entry.book!==original.entries[i].book))throw Error('Host identity lost');
  const record={type,width,modelCalls:window.layoutStats.model-before.model,bayRoofCalls:window.layoutStats.roof-before.roof,units:actual.unitCount,entries:actual.entries.length};proof.push(record);
  // The requested tall-plant fix intentionally changed the old roof policy.
  // Keep exact legacy parity above and independently verify all tall plants
  // against the new bay-fit contract, without modifying the frozen reference.
  const tall=fixture(36,width,true),fitted=shelfModelLayout(tall,type);let tallPlants=0;
  for(let i=0;i<tall.entries.length;i++)if(tall.entries[i].kind==='plant'){
   const source=tall.entries[i],entry=fitted.entries[i],row=fitted.rows[source.shelf];
   const fit=Math.min(1,(row.bottom-row.top-4*width/600)/source.height);
   if(entry.rooftop||entry.height!==source.height*fit||entry.width!==source.width*fit||entry.depth!==source.depth*fit||entry.y!==row.bottom-entry.height/2||entry.x!==row.left+source.x)throw Error('Tall plant does not fit its saved bay uniformly');
   if(entry.node!==source.node||entry.book!==source.book)throw Error('Tall plant metadata ownership lost');tallPlants++;
  }
  proof.at(-1).tallPlants=tallPlants;
  // Explicit legacy rooftop records still exercise the original roof packer,
  // even though newly fitted plants no longer need that migration path.
  const legacy=reference(fixture(36,width,true),type),owned=legacy.entries.map(e=>[e.node,e.book]);
  const roofExpected=roofReference(structuredClone(legacy)),roofBefore=window.layoutStats.roof,packed=placeRooftopPlants(legacy);
  if(JSON.stringify(packed)!==JSON.stringify(roofExpected))throw Error('Legacy roof packing differs');
  if(packed.entries.some((entry,i)=>entry.node!==owned[i][0]||entry.book!==owned[i][1]))throw Error('Roof metadata ownership lost');
  record.roofCalls=window.layoutStats.roof-roofBefore;
 }
 for(const count of [12,50,300]) {
  const original=fixture(count,390),js=()=>reference(original,'baggebo'),rust=()=>shelfModelLayout(original,'baggebo');
  for(let i=0;i<10;i++){js();rust();}
  const times={js:[],rust:[]};for(let r=0;r<9;r++)for(const kind of r%2?['rust','js']:['js','rust']){
   const start=performance.now();for(let i=0;i<50;i++)(kind==='js'?js:rust)();times[kind].push((performance.now()-start)/50);
  }
  const median=a=>[...a].sort((a,b)=>a-b)[4];samples.push({count,js:median(times.js),rust:median(times.rust),times});
 }
 return {proof,samples,memory:{...window.layoutStats},retained:[scratchPointer,scratch().length]};
};
</script>`;
let vite,http,url;
test.beforeAll(async()=>{
 vite=await createServer({configFile:false,root:process.cwd(),base:'/inhouse-read/',optimizeDeps:{noDiscovery:true},
 server:{middlewareMode:true,hmr:false,watch:null},plugins:[{name:'physical-fixture',configureServer(server){server.middlewares.use(async(req,res,next)=>{
  if(req.url?.split('?')[0]!=='/inhouse-read/__physical')return next();
  try{res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml('/inhouse-read/__physical',html));}catch(e){next(e);}
 });}}]});
 http=createHttpServer(vite.middlewares);await new Promise(r=>http.listen(0,'127.0.0.1',r));
 url='http://127.0.0.1:'+http.address().port+'/inhouse-read/__physical';
});
test.afterAll(async()=>{http?.closeAllConnections();if(http)await new Promise(r=>http.close(r));await vite?.close();});
test('compiled physical layout preserves exact bays, roofs, metadata and allocation ownership',async({page},info)=>{
 test.setTimeout(90_000);
 await page.addInitScript(()=>{
  const stats=window.layoutStats={model:0,roof:0,live:0,peak:0,arenas:{},badReleases:0};
  for(const name of ['instantiate','instantiateStreaming'])if(WebAssembly[name]){
   const original=WebAssembly[name];WebAssembly[name]=async function(...args){
    const result=await original.apply(WebAssembly,args),instance=result.instance||result,core=instance.exports;
    if(!core.shelf_model)return result;
    const exports={...core,alloc_f64(n){const p=core.alloc_f64(n);if(p){stats.arenas[p]=n;stats.live+=n*8;stats.peak=Math.max(stats.peak,stats.live);}return p;},
     free_f64(p,n){if(stats.arenas[p]!==n)stats.badReleases++;delete stats.arenas[p];stats.live-=n*8;return core.free_f64(p,n);},
     shelf_model(...args){stats.model++;return core.shelf_model(...args);},shelf_place(...args){stats.roof++;return core.shelf_place(...args);}};
    return result.instance?{...result,instance:{exports}}:{exports};
   };
  }
 });
 const cdp=await page.context().newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
 await page.setViewportSize({width:390,height:844});await page.goto(url);await page.waitForFunction(()=>window.checkPhysical);
 const result=await page.evaluate(()=>window.checkPhysical());
 expect(result.proof).toHaveLength(6);for(const p of result.proof){expect(p.modelCalls).toBe(1);expect(p.bayRoofCalls).toBe(0);expect(p.roofCalls).toBe(1);expect(p.entries).toBe(36);expect(p.tallPlants).toBe(12);}
 // Catalogue scalar kernels deliberately retain one 16-word scratch arena.
 // Every measured layout/roof arena must be freed with its exact size.
 expect(result.retained[1]).toBe(16);expect(result.memory.live).toBe(128);expect(result.memory.badReleases).toBe(0);
 expect(Object.entries(result.memory.arenas)).toEqual([[String(result.retained[0]),16]]);
 await info.attach('physical-layout-parity-and-timing',{body:JSON.stringify(result),contentType:'application/json'});
 console.log(JSON.stringify(result.samples.map(({times,...sample})=>sample)));
});
