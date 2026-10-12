import {test,expect} from '@playwright/test';
import {createServer} from 'vite';
import {createServer as createHttpServer} from 'node:http';
const html=`<!doctype html><script type="module">
import {loadRustCore} from '/inhouse-read/src/js/rust-core.js';
import {createShelfOcclusion} from '/inhouse-read/src/js/shelf-furniture.js';
import {createShelfOcclusion as reference} from '/inhouse-read/tests/unit/helpers/reference-shelf-furniture.js';
const core=await loadRustCore();if(!core?.shelf_occlusion)throw Error('Actual occlusion kernel required');
window.checkOcclusion=()=>{
 const results=[];
 for(const count of [3,12,100])for(const lit of [false,true]){
  const options={width:390,height:count*212,depth:155,rows:Array.from({length:count},(_,i)=>({bottom:(i+1)*212})),
   footprints:[{x:260,z:-30,radius:32}],floorLight:lit?[.5,.4,.29,.11]:null};
  const actual=createShelfOcclusion(options),expected=reference(options);let bytes=0;
  try{
   for(const name of ['position','color']){
    const a=actual.attributes[name].array,b=expected.attributes[name].array;
    const av=new Uint32Array(a.buffer),bv=new Uint32Array(b.buffer);
    if(av.length!==bv.length)throw Error('Vertex count mismatch');
    for(let i=0;i<av.length;i++)if(av[i]!==bv[i])throw Error(name+' byte mismatch at '+i);
    bytes+=a.byteLength;
   }
   if(JSON.stringify(actual.boundingBox)!==JSON.stringify(expected.boundingBox)||JSON.stringify(actual.boundingSphere)!==JSON.stringify(expected.boundingSphere))throw Error('Bounds changed');
  }finally{actual.dispose();expected.dispose();}
  const run=kind=>{const g=(kind==='rust'?createShelfOcclusion:reference)(options);g.dispose();};
  for(let i=0;i<8;i++){run('js');run('rust');}
  const capacityBefore=core.memory.buffer.byteLength,timings={js:[],rust:[]};
  for(let round=0;round<9;round++)for(const kind of round%2?['rust','js']:['js','rust']){
   const start=performance.now();for(let i=0;i<20;i++)run(kind);timings[kind].push((performance.now()-start)/20);
  }
  const median=a=>[...a].sort((a,b)=>a-b)[4];
  results.push({count,lit,bytes,js:median(timings.js),rust:median(timings.rust),timings,capacityBefore,capacityAfter:core.memory.buffer.byteLength});
 }
 return results;
};
</script>`;
let vite,http,url;
test.beforeAll(async()=>{
 vite=await createServer({configFile:false,root:process.cwd(),base:'/inhouse-read/',optimizeDeps:{noDiscovery:true},server:{middlewareMode:true,hmr:false,watch:null},plugins:[{name:'occlusion-fixture',configureServer(server){server.middlewares.use(async(req,res,next)=>{
  if(req.url?.split('?')[0]!=='/inhouse-read/__occlusion')return next();
  try{res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml('/inhouse-read/__occlusion',html));}catch(e){next(e);}
 });}}]});
 http=createHttpServer(vite.middlewares);await new Promise(r=>http.listen(0,'127.0.0.1',r));url='http://127.0.0.1:'+http.address().port+'/inhouse-read/__occlusion';
});
test.afterAll(async()=>{http?.closeAllConnections();if(http)await new Promise(r=>http.close(r));await vite?.close();});
test('contact shadows retain every vertex and benchmark complete geometry construction',async({page},testInfo)=>{
 test.setTimeout(60000);const cdp=await page.context().newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
 await page.goto(url);await page.waitForFunction(()=>typeof window.checkOcclusion==='function');
 const result=await page.evaluate(()=>window.checkOcclusion());
 for(const row of result)expect(row.capacityAfter).toBe(row.capacityBefore);
 console.log(JSON.stringify(result));await testInfo.attach('contact-shadow-proof',{body:JSON.stringify(result,null,2),contentType:'application/json'});
});
