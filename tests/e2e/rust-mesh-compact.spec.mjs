import {test,expect} from '@playwright/test';
import {createServer} from 'vite';
import {createServer as createHttpServer} from 'node:http';
import {pdfImageTrackingPatch} from '../../scripts/pdf-image-tracking-patch.mjs';
const html=`<!doctype html><script type="module">
import * as THREE from '/inhouse-read/node_modules/three/build/three.module.js';
import {loadRustCore} from '/inhouse-read/src/js/rust-core.js';
import {rustCompactGeometry} from '/inhouse-read/src/js/mesh-compact-wasm.js';
import {compactGeometry as reference} from '/inhouse-read/tests/unit/helpers/reference-mesh-compact.js';
import {expandedMetal} from '/inhouse-read/tests/unit/helpers/reference-baggebo-model.js';
const core=await loadRustCore();if(!core?.mesh_compact)throw Error('Actual mesh core required');
window.checkMesh=()=>{
 const results=[];
 for(const [width,depth] of [[20,20],[200,220],[567.5,220]]){
  const source=expandedMetal(-width/2,width/2,0,depth,(u,v,n)=>[u,n,-v]);
  if(width===200)source.setAttribute('color',new THREE.Float32BufferAttribute(new Float32Array(source.attributes.position.array.length).fill(.8),3));
  const expected=reference(source),actual=rustCompactGeometry(source);if(!actual)throw Error('Native mesh fell back');let bytes=0;
  function same(a,b){if(a.constructor!==b.constructor||a.byteLength!==b.byteLength)throw Error('Attribute type differs');const x=new Uint8Array(a.buffer,a.byteOffset,a.byteLength),y=new Uint8Array(b.buffer,b.byteOffset,b.byteLength);for(let i=0;i<x.length;i++)if(x[i]!==y[i])throw Error('Byte['+i+'] differs');bytes+=x.length;}
  for(const key of Object.keys(expected.attributes)){same(actual.attributes[key].array,expected.attributes[key].array);if(actual.attributes[key].normalized!==expected.attributes[key].normalized)throw Error('Normalized differs');}same(actual.index.array,expected.index.array);
  const vertices=source.attributes.position.count,unique=actual.attributes.position.count;actual.dispose();expected.dispose();
  const run=type=>{const result=(type==='rust'?rustCompactGeometry:reference)(source);if(!result)throw Error('Missing mesh');result.dispose();};
  for(let i=0;i<3;i++){run('rust');run('js');}
  const before=core.memory.buffer.byteLength,timings={js:[],rust:[]};
  for(let round=0;round<9;round++)for(const type of round%2?['rust','js']:['js','rust']){const start=performance.now();run(type);timings[type].push(performance.now()-start);}
  const median=a=>[...a].sort((a,b)=>a-b)[4];results.push({width,depth,vertices,unique,comparedBytes:bytes,js:median(timings.js),rust:median(timings.rust),timings,capacityBefore:before,capacityAfter:core.memory.buffer.byteLength});source.dispose();
 }
 return results;
};
</script>`;
let vite,http,url;
test.beforeAll(async()=>{
 vite=await createServer({configFile:false,root:process.cwd(),base:'/inhouse-read/',optimizeDeps:{noDiscovery:true},server:{middlewareMode:true,hmr:false,watch:null},plugins:[pdfImageTrackingPatch(),{name:'pdf-images-fixture',configureServer(server){server.middlewares.use(async(req,res,next)=>{
  if(req.url?.split('?')[0]!=='/inhouse-read/__mesh-compact')return next();
  try{res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml('/inhouse-read/__mesh-compact',html));}catch(e){next(e);}
 });}}]});
 http=createHttpServer(vite.middlewares);await new Promise(r=>http.listen(0,'127.0.0.1',r));url='http://127.0.0.1:'+http.address().port+'/inhouse-read/__mesh-compact';
});
test.afterAll(async()=>{http?.closeAllConnections();if(http)await new Promise(r=>http.close(r));await vite?.close();});
for(const method of ['checkMesh'])test('Rust mesh: '+method,async({page},testInfo)=>{
 test.setTimeout(120_000);const cdp=await page.context().newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
 await page.goto(url);await page.waitForFunction(method=>typeof window[method]==='function',method);
 const result=await page.evaluate(method=>window[method](),method);
 if(Array.isArray(result))for(const row of result)expect(row.capacityAfter).toBe(row.capacityBefore);
 else{expect(result.crops).toBe(32);expect(result.renderedImages).toBe(32);}
 console.log(JSON.stringify(result));await testInfo.attach(method,{body:JSON.stringify(result,null,2),contentType:'application/json'});
});
