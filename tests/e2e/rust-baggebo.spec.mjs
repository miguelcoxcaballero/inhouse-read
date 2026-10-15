import {test,expect} from '@playwright/test';
import {createServer} from 'vite';
import {createServer as createHttpServer} from 'node:http';
// Real Chromium: the Rust shelf module draws the whole IKEA BAGGEBO (posts, pans, tabs, screws, expanded-metal
// sheets, brace) with the browser's own Math; the model is compared byte for byte with the frozen JavaScript
// original built from three.js, and both are timed (cold first build, then repeated builds, alternating).
const html=`<!doctype html><script type="module">
import {loadRustShelf} from '/inhouse-read/src/js/rust-shelf.js';
import {createBaggebo} from '/inhouse-read/src/js/baggebo-model.js';
import {createBaggebo as reference} from '/inhouse-read/tests/unit/helpers/reference-baggebo-model.js';
const shelf=await loadRustShelf();if(!shelf?.baggebo_template)throw Error('Actual shelf module with the BAGGEBO required');
const bytes=a=>new Uint8Array(a.buffer,a.byteOffset,a.byteLength);
const same=(a,b)=>a.length===b.length&&a.every((value,i)=>value===b[i]);
window.checkBaggebo=()=>{
 // Cold: the first build of each implementation (the template is built once and then cloned).
 let start=performance.now();const first=createBaggebo();const coldRust=performance.now()-start;
 start=performance.now();const second=reference();const coldJs=performance.now()-start;
 let comparedBytes=0;
 try{
  if(JSON.stringify(first.userData.parts)!==JSON.stringify(second.userData.parts))throw Error('Parts differ');
  if(first.children.length!==second.children.length)throw Error('Batches differ');
  for(let i=0;i<second.children.length;i++){
   const a=first.children[i].geometry,b=second.children[i].geometry;
   if(Object.keys(a.attributes).join()!==Object.keys(b.attributes).join())throw Error('Attribute order differs');
   for(const name of Object.keys(b.attributes)){
    const x=a.attributes[name],y=b.attributes[name];
    if(x.array.constructor!==y.array.constructor||x.normalized!==y.normalized||!same(bytes(x.array),bytes(y.array)))throw Error('Attribute bytes differ: '+name);comparedBytes+=y.array.byteLength;
   }
   if(a.index.array.constructor!==b.index.array.constructor||!same(bytes(a.index.array),bytes(b.index.array)))throw Error('Index differs');
   if(JSON.stringify(a.boundingBox)!==JSON.stringify(b.boundingBox)||JSON.stringify(a.boundingSphere)!==JSON.stringify(b.boundingSphere))throw Error('Bounds differ');
  }
 }finally{first.userData.dispose();second.userData.dispose();}
 const run=kind=>{const model=(kind==='rust'?createBaggebo:reference)();model.userData.dispose();};
 for(let i=0;i<3;i++){run('rust');run('js');}
 const timings={js:[],rust:[]};
 for(let round=0;round<9;round++)for(const kind of round%2?['rust','js']:['js','rust']){const t=performance.now();for(let i=0;i<5;i++)run(kind);timings[kind].push((performance.now()-t)/5);}
 const median=a=>[...a].sort((x,y)=>x-y)[4];
 return{comparedBytes,coldRust,coldJs,js:median(timings.js),rust:median(timings.rust),handles:shelf.shelf_live_handles()};
};
</script>`;
let vite,http,url;
test.beforeAll(async()=>{
 vite=await createServer({configFile:false,root:process.cwd(),base:'/inhouse-read/',optimizeDeps:{noDiscovery:true},server:{middlewareMode:true,hmr:false,watch:null},plugins:[{name:'baggebo-fixture',configureServer(server){server.middlewares.use(async(req,res,next)=>{
  if(req.url?.split('?')[0]!=='/inhouse-read/__baggebo')return next();
  try{res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml('/inhouse-read/__baggebo',html));}catch(e){next(e);}
 });}}]});
 http=createHttpServer(vite.middlewares);await new Promise(r=>http.listen(0,'127.0.0.1',r));url='http://127.0.0.1:'+http.address().port+'/inhouse-read/__baggebo';
});
test.afterAll(async()=>{http?.closeAllConnections();if(http)await new Promise(r=>http.close(r));await vite?.close();});
test('the BAGGEBO built by the Rust shelf module is byte-identical to the three.js original',async({page},testInfo)=>{
 test.setTimeout(120_000);const cdp=await page.context().newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
 await page.goto(url);await page.waitForFunction(()=>typeof window.checkBaggebo==='function');
 const result=await page.evaluate(()=>window.checkBaggebo());
 expect(result.comparedBytes).toBeGreaterThan(1_000_000);
 console.log(JSON.stringify(result));await testInfo.attach('baggebo',{body:JSON.stringify(result,null,2),contentType:'application/json'});
});
