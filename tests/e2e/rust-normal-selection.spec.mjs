import {test,expect} from '@playwright/test';
import {createServer} from 'vite';
import {createServer as createHttpServer} from 'node:http';
import {pdfImageTrackingPatch} from '../../scripts/pdf-image-tracking-patch.mjs';
const html=`<!doctype html><script type="module">
import {loadRustCore} from '/inhouse-read/src/js/rust-core.js';
import {wasmHeightToNormals} from '/inhouse-read/src/js/cover-relief-wasm.js';
import {mapsFor} from '/inhouse-read/tests/helpers/cover-relief-reference.mjs';
const core=await loadRustCore();if(!core?.relief_normal_selected_rows)throw Error('Actual selection core required');
const drain=task=>{let step;do{step=task.next();}while(!step.done);return step.value;};
window.checkSelection=()=>{
 const results=[];
 for(const [w,h] of [[32,32],[128,128],[256,256],[512,512]])for(const withMask of [true,false]){
  const maps=mapsFor(w,h,79),n=w*h,unit=.6/255/(2*(200/Math.max(w,h)));
  if(!withMask){delete maps.mask;maps.preserveInk=false;}
  const run=type=>{
   if(type==='fused')return drain(wasmHeightToNormals(core,maps,unit,{selectionAlpha:true}));
   const original=drain(wasmHeightToNormals(core,maps,unit)),normals=original.slice();
   for(let i=0;i<n;i++)normals[i*4+3]=maps.mask?.[i]??Math.max(maps.gloss[i],maps.foil[i],maps.heightMap?.[i]??0);
   return normals;
  };
  const actual=run('fused'),expected=run('previous');
  for(let i=0;i<actual.length;i++)if(actual[i]!==expected[i])throw Error('Normal mismatch '+i);
  for(let i=0;i<4;i++){run('previous');run('fused');}
  const before=core.memory.buffer.byteLength,timings={previous:[],fused:[]};
  for(let round=0;round<9;round++)for(const type of round%2?['fused','previous']:['previous','fused']){
   const start=performance.now();for(let i=0;i<5;i++)run(type);timings[type].push((performance.now()-start)/5);
  }
  const median=a=>[...a].sort((a,b)=>a-b)[4];results.push({w,h,withMask,comparedBytes:n*4,previous:median(timings.previous),fused:median(timings.fused),timings,capacityBefore:before,capacityAfter:core.memory.buffer.byteLength});
 }
 return results;
};
</script>`;
let vite,http,url;
test.beforeAll(async()=>{
 vite=await createServer({configFile:false,root:process.cwd(),base:'/inhouse-read/',optimizeDeps:{noDiscovery:true},server:{middlewareMode:true,hmr:false,watch:null},plugins:[pdfImageTrackingPatch(),{name:'pdf-images-fixture',configureServer(server){server.middlewares.use(async(req,res,next)=>{
  if(req.url?.split('?')[0]!=='/inhouse-read/__normal-selection')return next();
  try{res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml('/inhouse-read/__normal-selection',html));}catch(e){next(e);}
 });}}]});
 http=createHttpServer(vite.middlewares);await new Promise(r=>http.listen(0,'127.0.0.1',r));url='http://127.0.0.1:'+http.address().port+'/inhouse-read/__normal-selection';
});
test.afterAll(async()=>{http?.closeAllConnections();if(http)await new Promise(r=>http.close(r));await vite?.close();});
for(const method of ['checkSelection'])test('Rust selected normals: '+method,async({page},testInfo)=>{
 test.setTimeout(120_000);const cdp=await page.context().newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
 await page.goto(url);await page.waitForFunction(method=>typeof window[method]==='function',method);
 const result=await page.evaluate(method=>window[method](),method);
 if(Array.isArray(result))for(const row of result)expect(row.capacityAfter).toBe(row.capacityBefore);
 else{expect(result.crops).toBe(32);expect(result.renderedImages).toBe(32);}
 console.log(JSON.stringify(result));await testInfo.attach(method,{body:JSON.stringify(result,null,2),contentType:'application/json'});
});
