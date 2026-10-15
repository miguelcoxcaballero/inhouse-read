import {test,expect} from '@playwright/test';
import {createServer} from 'vite';
import {createServer as createHttpServer} from 'node:http';
import {pdfImageTrackingPatch} from '../../scripts/pdf-image-tracking-patch.mjs';
const html=`<!doctype html><script type="module">
import * as THREE from '/inhouse-read/node_modules/three/build/three.module.js';
import {loadRustCore} from '/inhouse-read/src/js/rust-core.js';
import {createShelfFurniture} from '/inhouse-read/src/js/shelf-furniture.js';
import {createShelfFurniture as reference} from '/inhouse-read/tests/unit/helpers/reference-shelf-furniture.js';
const core=await loadRustCore();if(!core?.cabinet_build)throw Error('Actual cabinet core required');
window.checkTimber=()=>{
 const results=[],wood=new THREE.MeshStandardMaterial(),backWood=new THREE.MeshStandardMaterial(),darkWood=new THREE.MeshStandardMaterial();
 try{for(const count of [3,12,100]){
  const options={width:390,height:count*210,depth:155,rows:Array.from({length:count},(_,i)=>({bottom:(i+1)*210-20})),wood,backWood,darkWood};
  const expected=reference(options),actual=createShelfFurniture(options);let bytes=0;
  try{
   if(JSON.stringify(actual.userData.parts)!==JSON.stringify(expected.userData.parts)||actual.children.length!==expected.children.length)throw Error('Parts differ');
   for(let i=0;i<expected.children.length;i++)for(const name of ['position','normal','uv','color']){
    const a=actual.children[i].geometry.attributes[name].array,b=expected.children[i].geometry.attributes[name].array;
    const av=new Uint32Array(a.buffer,a.byteOffset,a.length),bv=new Uint32Array(b.buffer,b.byteOffset,b.length);
    if(av.length!==bv.length)throw Error('Vertex count differs');for(let j=0;j<av.length;j++)if(av[j]!==bv[j])throw Error('Vertex byte changed');bytes+=a.byteLength;
   }
  }finally{actual.userData.disposeGeometry();expected.userData.disposeGeometry();}
  const run=kind=>{const result=(kind==='rust'?createShelfFurniture:reference)(options);result.userData.disposeGeometry();};
  for(let i=0;i<3;i++){run('rust');run('js');}
  const before=core.memory.buffer.byteLength,timings={js:[],rust:[]},repetitions=count<100?10:2;
  for(let round=0;round<9;round++)for(const kind of round%2?['rust','js']:['js','rust']){
   const start=performance.now();for(let i=0;i<repetitions;i++)run(kind);timings[kind].push((performance.now()-start)/repetitions);
  }
  const median=a=>[...a].sort((a,b)=>a-b)[4];results.push({count,comparedBytes:bytes,js:median(timings.js),rust:median(timings.rust),timings,capacityBefore:before,capacityAfter:core.memory.buffer.byteLength});
 }}finally{wood.dispose();backWood.dispose();darkWood.dispose();}
 return results;
};
</script>`;
let vite,http,url;
test.beforeAll(async()=>{
 vite=await createServer({configFile:false,root:process.cwd(),base:'/inhouse-read/',optimizeDeps:{noDiscovery:true},server:{middlewareMode:true,hmr:false,watch:null},plugins:[pdfImageTrackingPatch(),{name:'pdf-images-fixture',configureServer(server){server.middlewares.use(async(req,res,next)=>{
  if(req.url?.split('?')[0]!=='/inhouse-read/__timber')return next();
  try{res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml('/inhouse-read/__timber',html));}catch(e){next(e);}
 });}}]});
 http=createHttpServer(vite.middlewares);await new Promise(r=>http.listen(0,'127.0.0.1',r));url='http://127.0.0.1:'+http.address().port+'/inhouse-read/__timber';
});
test.afterAll(async()=>{http?.closeAllConnections();if(http)await new Promise(r=>http.close(r));await vite?.close();});
for(const method of ['checkTimber'])test('Rust timber: '+method,async({page},testInfo)=>{
 test.setTimeout(60_000);const cdp=await page.context().newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
 await page.goto(url);await page.waitForFunction(method=>typeof window[method]==='function',method);
 const result=await page.evaluate(method=>window[method](),method);
 if(Array.isArray(result))for(const row of result)expect(row.capacityAfter).toBe(row.capacityBefore);
 else{expect(result.crops).toBe(32);expect(result.renderedImages).toBe(32);}
 console.log(JSON.stringify(result));await testInfo.attach(method,{body:JSON.stringify(result,null,2),contentType:'application/json'});
});
