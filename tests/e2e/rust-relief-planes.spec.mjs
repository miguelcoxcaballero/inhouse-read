import {test,expect} from '@playwright/test';
import {createServer} from 'vite';
import {createServer as createHttpServer} from 'node:http';
import {pdfImageTrackingPatch} from '../../scripts/pdf-image-tracking-patch.mjs';
const html=`<!doctype html><script type="module">
import {loadRustCore} from '/inhouse-read/src/js/rust-core.js';
import {wasmReliefRgbaPlanes} from '/inhouse-read/src/js/cover-relief-wasm.js';
const core=await loadRustCore();if(!core?.relief_rgba_planes)throw Error('Actual plane core required');
function reference(maps){const out={};for(const [key,input] of [['height',maps.heightMap],['foil',maps.foil],['gloss',maps.gloss]]){const result=new Uint8ClampedArray(input.length*4);for(let i=0;i<input.length;i++){result[i*4]=result[i*4+1]=result[i*4+2]=input[i];result[i*4+3]=255;}out[key]=result;}return out;}
window.checkPlanes=()=>{
 const results=[];
 for(const [w,h] of [[32,32],[128,128],[288,384],[512,512],[1024,1024]]){
  const n=w*h,maps={width:w,height:h,heightMap:Uint8Array.from({length:n},(_,i)=>i%256),foil:Uint8Array.from({length:n},(_,i)=>(i*13+77)%256),gloss:Uint8Array.from({length:n},(_,i)=>(i*89+253)%256)};
  const actual=wasmReliefRgbaPlanes(core,maps),expected=reference(maps);if(!actual)throw Error('Native planes fell back');
  for(const key of Object.keys(expected))for(let i=0;i<expected[key].length;i++)if(actual[key][i]!==expected[key][i])throw Error(key+' byte '+i);
  const run=type=>type==='rust'?wasmReliefRgbaPlanes(core,maps):reference(maps);
  for(let i=0;i<4;i++){run('rust');run('js');}
  const before=core.memory.buffer.byteLength,timings={js:[],rust:[]};
  for(let round=0;round<9;round++)for(const type of round%2?['rust','js']:['js','rust']){const start=performance.now();for(let i=0;i<10;i++)run(type);timings[type].push((performance.now()-start)/10);}
  const median=a=>[...a].sort((a,b)=>a-b)[4];results.push({w,h,comparedBytes:n*12,js:median(timings.js),rust:median(timings.rust),timings,capacityBefore:before,capacityAfter:core.memory.buffer.byteLength});
 }
 return results;
};
</script>`;
let vite,http,url;
test.beforeAll(async()=>{
 vite=await createServer({configFile:false,root:process.cwd(),base:'/inhouse-read/',optimizeDeps:{noDiscovery:true},server:{middlewareMode:true,hmr:false,watch:null},plugins:[pdfImageTrackingPatch(),{name:'pdf-images-fixture',configureServer(server){server.middlewares.use(async(req,res,next)=>{
  if(req.url?.split('?')[0]!=='/inhouse-read/__relief-planes')return next();
  try{res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml('/inhouse-read/__relief-planes',html));}catch(e){next(e);}
 });}}]});
 http=createHttpServer(vite.middlewares);await new Promise(r=>http.listen(0,'127.0.0.1',r));url='http://127.0.0.1:'+http.address().port+'/inhouse-read/__relief-planes';
});
test.afterAll(async()=>{http?.closeAllConnections();if(http)await new Promise(r=>http.close(r));await vite?.close();});
for(const method of ['checkPlanes'])test('Rust planes: '+method,async({page},testInfo)=>{
 test.setTimeout(120_000);const cdp=await page.context().newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
 await page.goto(url);await page.waitForFunction(method=>typeof window[method]==='function',method);
 const result=await page.evaluate(method=>window[method](),method);
 if(Array.isArray(result))for(const row of result)expect(row.capacityAfter).toBe(row.capacityBefore);
 else{expect(result.crops).toBe(32);expect(result.renderedImages).toBe(32);}
 console.log(JSON.stringify(result));await testInfo.attach(method,{body:JSON.stringify(result,null,2),contentType:'application/json'});
});
