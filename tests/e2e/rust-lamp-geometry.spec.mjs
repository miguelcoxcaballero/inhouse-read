import {test,expect} from '@playwright/test';
import {createServer} from 'vite';
import {createServer as createHttpServer} from 'node:http';
// Real Chromium: the Rust shelf module draws the geometry of the three shelf lamps (lathes, tori, tubes along Catmull-Rom
// curves, rounded boxes, merged by material and fitted by the lamp's scale) with the browser's own Math. Every mesh is
// compared, byte for byte, with the frozen JavaScript original built from three.js, and both are timed (cold first lamp,
// then repeated lamps, alternating). The lamp surfaces (textures) are painted by the decor core and are not part of this.
const html=`<!doctype html><script type="module">
import {loadRustShelf} from '/inhouse-read/src/js/rust-shelf.js';
import {loadRustDecorCore} from '/inhouse-read/src/js/rust-decor-core.js';
import {createShelfLamp} from '/inhouse-read/src/js/shelf-lamps.js';
import {createShelfLamp as reference} from '/inhouse-read/tests/unit/helpers/reference-shelf-lamps.js';
const shelf=await loadRustShelf();if(!shelf?.lamp_geometry)throw Error('Actual shelf module with the lamps required');
if(!await loadRustDecorCore())throw Error('Decor core required for the lamp surfaces');
const bytes=a=>new Uint8Array(a.buffer,a.byteOffset,a.byteLength);
const meshes=group=>{const list=[];group.traverse(o=>{if(o.isMesh)list.push(o);});return list;};
window.checkLamps=()=>{
 const lamps=['mittled','tarnaby','tripod'],options=lampId=>({lampId,width:lampId==='tarnaby'?120:lampId==='tripod'?260:90,quality:'high'});
 let compared=0;
 // Both implementations keep the painted surfaces of the first lamp of each kind: build one of each first, so that
 // the times below are the geometry's (and the materials') and not the textures'.
 for(const lampId of lamps){createShelfLamp(options(lampId)).dispose();reference(options(lampId)).dispose();}
 for(const lampId of lamps){
  const a=createShelfLamp(options(lampId)),b=reference(options(lampId));
  try{
   const x=meshes(a),y=meshes(b);if(x.length!==y.length)throw Error('Meshes differ for '+lampId);
   for(let i=0;i<y.length;i++){
    if(x[i].name!==y[i].name)throw Error('Mesh name '+x[i].name+' / '+y[i].name);
    if(Object.keys(x[i].geometry.attributes).join()!==Object.keys(y[i].geometry.attributes).join())throw Error('Attribute order '+y[i].name);
    for(const name of Object.keys(y[i].geometry.attributes)){
     const l=bytes(x[i].geometry.attributes[name].array),r=bytes(y[i].geometry.attributes[name].array);
     if(l.length!==r.length)throw Error('Length '+y[i].name+'/'+name);
     for(let k=0;k<l.length;k++)if(l[k]!==r[k])throw Error('Byte '+y[i].name+'/'+name+' '+k);
     compared+=l.length;
    }
    const li=x[i].geometry.index,ri=y[i].geometry.index;
    if(!!li!==!!ri)throw Error('Index presence '+y[i].name);
    if(ri){if(li.array.constructor!==ri.array.constructor)throw Error('Index type '+y[i].name);const l=bytes(li.array),r=bytes(ri.array);for(let k=0;k<l.length;k++)if(l[k]!==r[k])throw Error('Index byte '+y[i].name);compared+=l.length;}
    if(JSON.stringify(x[i].geometry.boundingBox)!==JSON.stringify(y[i].geometry.boundingBox))throw Error('Box '+y[i].name);
   }
   if(JSON.stringify(a.userData.lightEmitter)!==JSON.stringify(b.userData.lightEmitter))throw Error('Emitter '+lampId);
  }finally{a.dispose();b.dispose();}
 }
 const run=(kind,lampId)=>{const lamp=(kind==='rust'?createShelfLamp:reference)(options(lampId));lamp.dispose();};
 const results=[];
 for(const lampId of lamps){
  for(let i=0;i<3;i++){run('rust',lampId);run('js',lampId);}
  const timings={js:[],rust:[]};
  for(let round=0;round<9;round++)for(const kind of round%2?['rust','js']:['js','rust']){const t=performance.now();for(let i=0;i<5;i++)run(kind,lampId);timings[kind].push((performance.now()-t)/5);}
  const median=a=>[...a].sort((p,q)=>p-q)[4];
  results.push({lampId,js:median(timings.js),rust:median(timings.rust)});
 }
 return{compared,results,handles:shelf.shelf_live_handles()};
};
</script>`;
let vite,http,url;
test.beforeAll(async()=>{
 vite=await createServer({configFile:false,root:process.cwd(),base:'/inhouse-read/',optimizeDeps:{noDiscovery:true},server:{middlewareMode:true,hmr:false,watch:null},plugins:[{name:'lamp-fixture',configureServer(server){server.middlewares.use(async(req,res,next)=>{
  if(req.url?.split('?')[0]!=='/inhouse-read/__lamps')return next();
  try{res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml('/inhouse-read/__lamps',html));}catch(e){next(e);}
 });}}]});
 http=createHttpServer(vite.middlewares);await new Promise(r=>http.listen(0,'127.0.0.1',r));url='http://127.0.0.1:'+http.address().port+'/inhouse-read/__lamps';
});
test.afterAll(async()=>{http?.closeAllConnections();if(http)await new Promise(r=>http.close(r));await vite?.close();});
test('the lamps built by the Rust shelf module are byte-identical to the three.js original',async({page},testInfo)=>{
 test.setTimeout(180_000);const cdp=await page.context().newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
 await page.goto(url);await page.waitForFunction(()=>typeof window.checkLamps==='function');
 const result=await page.evaluate(()=>window.checkLamps());
 expect(result.compared).toBeGreaterThan(500_000);
 console.log(JSON.stringify(result));await testInfo.attach('lamps',{body:JSON.stringify(result,null,2),contentType:'application/json'});
});
