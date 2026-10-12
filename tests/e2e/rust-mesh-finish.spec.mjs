import {test,expect} from '@playwright/test';
import {createServer} from 'vite';
import {createServer as createHttpServer} from 'node:http';
import {pdfImageTrackingPatch} from '../../scripts/pdf-image-tracking-patch.mjs';
const html=`<!doctype html><script type="module">
import {RoundedBoxGeometry} from '/inhouse-read/node_modules/three/examples/jsm/geometries/RoundedBoxGeometry.js';
import {loadRustCore} from '/inhouse-read/src/js/rust-core.js';
import {rustFinishMesh,rustPaintMeshes} from '/inhouse-read/src/js/mesh-finish-wasm.js';
import {physicalPaintUVs,smoothPostNormals} from '/inhouse-read/tests/unit/helpers/reference-mesh-finish.js';
import {uprightProfile,extrudedSheet} from '/inhouse-read/tests/unit/helpers/reference-baggebo-model.js';
const core=await loadRustCore();if(!core?.mesh_finish)throw Error('Actual finishing core required');
window.checkFinish=()=>{
 const {points}=uprightProfile(),post=extrudedSheet(points.map(p=>[-(300-p.x),-p.y]),[],1160,0);
 const samples=[['rail',0,new RoundedBoxGeometry(220,15,200,1,.6)],['detailed rail',0,new RoundedBoxGeometry(220,15,200,8,.6)],['post',1,post]],results=[];
 for(const [label,kind,source] of samples){
  const original=kind===0?physicalPaintUVs:smoothPostNormals,actual=source.clone(),expected=source.clone();if(!rustFinishMesh(actual,kind))throw Error('Native finishing fell back');original(expected);let bytes=0;
  for(const name of Object.keys(expected.attributes)){const a=actual.attributes[name].array,b=expected.attributes[name].array,x=new Uint32Array(a.buffer,a.byteOffset,a.length),y=new Uint32Array(b.buffer,b.byteOffset,b.length);if(x.length!==y.length)throw Error('Count differs');for(let i=0;i<x.length;i++)if(x[i]!==y[i])throw Error(name+'['+i+'] differs');bytes+=a.byteLength;}actual.dispose();expected.dispose();
  const work=source.clone(),normal=source.attributes.normal.array,uv=source.attributes.uv.array;
  const run=type=>{work.attributes.normal.array.set(normal);work.attributes.uv.array.set(uv);if(type==='rust'){if(!rustFinishMesh(work,kind))throw Error('Missing finish');}else original(work);};
  for(let i=0;i<5;i++){run('rust');run('js');}
  const before=core.memory.buffer.byteLength,timings={js:[],rust:[]};
  for(let round=0;round<9;round++)for(const type of round%2?['rust','js']:['js','rust']){const start=performance.now();for(let i=0;i<20;i++)run(type);timings[type].push((performance.now()-start)/20);}
  const median=a=>[...a].sort((a,b)=>a-b)[4];results.push({label,kind,vertices:source.attributes.position.count,comparedBytes:bytes,js:median(timings.js),rust:median(timings.rust),timings,capacityBefore:before,capacityAfter:core.memory.buffer.byteLength});source.dispose();work.dispose();
 }
 return results;
};
window.checkBatch=()=>{
 const actual=Array.from({length:20},(_,i)=>new RoundedBoxGeometry(200+i,15,230,1,.6)),expected=actual.map(g=>g.clone());
 if(!rustPaintMeshes(actual))throw Error('Native batch fell back');expected.forEach(physicalPaintUVs);let bytes=0;
 for(let i=0;i<actual.length;i++)for(const name of Object.keys(expected[i].attributes)){const a=actual[i].attributes[name].array,b=expected[i].attributes[name].array,x=new Uint32Array(a.buffer,a.byteOffset,a.length),y=new Uint32Array(b.buffer,b.byteOffset,b.length);for(let at=0;at<x.length;at++)if(x[at]!==y[at])throw Error('Batch attribute differs');bytes+=a.byteLength;}
 const run=type=>{if(type==='rust'){if(!rustPaintMeshes(actual))throw Error('Missing batch');}else expected.forEach(physicalPaintUVs);};
 for(let i=0;i<5;i++){run('rust');run('js');}
 const before=core.memory.buffer.byteLength,timings={js:[],rust:[]};
 for(let round=0;round<9;round++)for(const type of round%2?['rust','js']:['js','rust']){const start=performance.now();for(let i=0;i<20;i++)run(type);timings[type].push((performance.now()-start)/20);}
 const median=a=>[...a].sort((a,b)=>a-b)[4],result={label:'20 paint pieces in one transfer',vertices:actual.reduce((n,g)=>n+g.attributes.position.count,0),comparedBytes:bytes,js:median(timings.js),rust:median(timings.rust),timings,capacityBefore:before,capacityAfter:core.memory.buffer.byteLength};actual.forEach(g=>g.dispose());expected.forEach(g=>g.dispose());return [result];
};
</script>`;
let vite,http,url;
test.beforeAll(async()=>{
 vite=await createServer({configFile:false,root:process.cwd(),base:'/inhouse-read/',optimizeDeps:{noDiscovery:true},server:{middlewareMode:true,hmr:false,watch:null},plugins:[pdfImageTrackingPatch(),{name:'pdf-images-fixture',configureServer(server){server.middlewares.use(async(req,res,next)=>{
  if(req.url?.split('?')[0]!=='/inhouse-read/__mesh-finish')return next();
  try{res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml('/inhouse-read/__mesh-finish',html));}catch(e){next(e);}
 });}}]});
 http=createHttpServer(vite.middlewares);await new Promise(r=>http.listen(0,'127.0.0.1',r));url='http://127.0.0.1:'+http.address().port+'/inhouse-read/__mesh-finish';
});
test.afterAll(async()=>{http?.closeAllConnections();if(http)await new Promise(r=>http.close(r));await vite?.close();});
for(const method of ['checkFinish','checkBatch'])test('Rust finish: '+method,async({page},testInfo)=>{
 test.setTimeout(120_000);const cdp=await page.context().newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
 await page.goto(url);await page.waitForFunction(method=>typeof window[method]==='function',method);
 const result=await page.evaluate(method=>window[method](),method);
 if(Array.isArray(result))for(const row of result)expect(row.capacityAfter).toBe(row.capacityBefore);
 else{expect(result.crops).toBe(32);expect(result.renderedImages).toBe(32);}
 console.log(JSON.stringify(result));await testInfo.attach(method,{body:JSON.stringify(result,null,2),contentType:'application/json'});
});
