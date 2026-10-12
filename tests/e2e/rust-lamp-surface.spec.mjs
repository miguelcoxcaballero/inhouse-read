import {test,expect} from '@playwright/test';
import {createServer} from 'vite';
import {createServer as createHttpServer} from 'node:http';
import {pdfImageTrackingPatch} from '../../scripts/pdf-image-tracking-patch.mjs';
const html=`<!doctype html><script type="module">
import {loadRustCore} from '/inhouse-read/src/js/rust-core.js';
import {rustLampSurface} from '/inhouse-read/src/js/lamp-surface-wasm.js';
import {lampSurface as reference} from '/inhouse-read/tests/unit/helpers/reference-lamp-surface.js';
const core=await loadRustCore();if(!core?.lamp_surface_rows)throw Error('Actual lamp core required');
window.checkLamp=()=>{
 const results=[];
 for(const kind of ['wood','linen','black'])for(const detail of [1,2]){
  const width=(kind==='wood'?128:256)*detail,height=kind==='wood'?512*detail:width;
  const expected=reference(kind,width,height),actual=rustLampSurface(kind,width,height);if(!actual)throw Error('Native lamp fell back');
  for(const name of ['pigment','data']){if(actual[name].length!==expected[name].length)throw Error('Size differs');for(let i=0;i<expected[name].length;i++)if(actual[name][i]!==expected[name][i])throw Error(kind+':'+detail+' '+name+'['+i+'] differs');}
  const run=type=>(type==='rust'?rustLampSurface:reference)(kind,width,height);
  for(let i=0;i<3;i++){run('rust');run('js');}
  const before=core.memory.buffer.byteLength,timings={js:[],rust:[]};
  for(let round=0;round<9;round++)for(const type of round%2?['rust','js']:['js','rust']){
   const start=performance.now();run(type);timings[type].push(performance.now()-start);
  }
  const median=a=>[...a].sort((a,b)=>a-b)[4];results.push({kind,detail,width,height,comparedBytes:width*height*8,js:median(timings.js),rust:median(timings.rust),timings,capacityBefore:before,capacityAfter:core.memory.buffer.byteLength});
 }
 return results;
};
</script>`;
let vite,http,url;
test.beforeAll(async()=>{
 vite=await createServer({configFile:false,root:process.cwd(),base:'/inhouse-read/',optimizeDeps:{noDiscovery:true},server:{middlewareMode:true,hmr:false,watch:null},plugins:[pdfImageTrackingPatch(),{name:'pdf-images-fixture',configureServer(server){server.middlewares.use(async(req,res,next)=>{
  if(req.url?.split('?')[0]!=='/inhouse-read/__lamp-surface')return next();
  try{res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml('/inhouse-read/__lamp-surface',html));}catch(e){next(e);}
 });}}]});
 http=createHttpServer(vite.middlewares);await new Promise(r=>http.listen(0,'127.0.0.1',r));url='http://127.0.0.1:'+http.address().port+'/inhouse-read/__lamp-surface';
});
test.afterAll(async()=>{http?.closeAllConnections();if(http)await new Promise(r=>http.close(r));await vite?.close();});
for(const method of ['checkLamp'])test('Rust lamp: '+method,async({page},testInfo)=>{
 test.setTimeout(120_000);const cdp=await page.context().newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
 await page.goto(url);await page.waitForFunction(method=>typeof window[method]==='function',method);
 const result=await page.evaluate(method=>window[method](),method);
 if(Array.isArray(result))for(const row of result)expect(row.capacityAfter).toBe(row.capacityBefore);
 else{expect(result.crops).toBe(32);expect(result.renderedImages).toBe(32);}
 console.log(JSON.stringify(result));await testInfo.attach(method,{body:JSON.stringify(result,null,2),contentType:'application/json'});
});
