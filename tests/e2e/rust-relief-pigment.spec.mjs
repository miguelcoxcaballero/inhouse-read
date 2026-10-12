import {test,expect} from '@playwright/test';
import {createServer} from 'vite';
import {createServer as createHttpServer} from 'node:http';
import {pdfImageTrackingPatch} from '../../scripts/pdf-image-tracking-patch.mjs';
const html=`<!doctype html><script type="module">
import {loadRustCore} from '/inhouse-read/src/js/rust-core.js';
import {wasmPigmentMaps} from '/inhouse-read/src/js/cover-relief-wasm.js';
import {referencePigment} from '/inhouse-read/tests/unit/helpers/reference-relief-pigment.js';
const core=await loadRustCore();if(!core?.relief_pigment_pixels)throw Error('Actual pigment core required');
function drain(task){let yields=0;for(;;){const step=task.next();if(step.done)return {out:step.value,yields};yields++;}}
function exact(a,b){if(a.yields!==b.yields)throw Error('Safe points differ');for(const key of Object.keys(b.out)){const x=a.out[key],y=b.out[key];if(x.length!==y.length)throw Error('Shape differs');for(let i=0;i<y.length;i++)if(!Object.is(x[i],y[i]))throw Error(key+' pixel '+i);}}
window.checkPigments=()=>{
 const results=[];
 for(const [w,h,layers] of [[128,192,0],[288,384,0],[512,512,0],[288,384,3],[512,512,10]]){
  const count=w*h,inputs=Array.from({length:Math.max(1,layers)},(_,layer)=>Float32Array.from({length:count},(_,i)=>{const x=i%w,y=Math.floor(i/w);return (x+layer*7)%67>52||(y+layer*11)%83>70?0:(128+(x*3+y*5+layer)%128)/255;}));
  const run=type=>{
   const fn=type==='rust'?wasmPigmentMaps:referencePigment;
   if(!layers)return drain(fn(core,inputs[0],w,h));
   let previous={owners:new Uint8Array(count),baseMask:new Uint8Array(count),baseHeight:new Float32Array(count)},yields=0;
   for(let i=0;i<layers;i++){const result=drain(fn(core,inputs[i],w,h,{...previous,owner:i+1,heightMM:.16+i*.014},false));if(!result.out)throw Error('Native classification fell back');previous=result.out;yields+=result.yields;}
   return {out:previous,yields};
  };
  const actual=run('rust'),expected=run('js');if(!actual.out)throw Error('Native pigment fell back');exact(actual,expected);
  for(let i=0;i<3;i++){run('rust');run('js');}
  const before=core.memory.buffer.byteLength,timings={js:[],rust:[]};
  for(let round=0;round<9;round++)for(const type of round%2?['rust','js']:['js','rust']){const start=performance.now();run(type);timings[type].push(performance.now()-start);}
  const median=a=>[...a].sort((a,b)=>a-b)[4];results.push({w,h,layers,comparedBytes:Object.values(actual.out).reduce((n,a)=>n+a.byteLength,0),yields:actual.yields,js:median(timings.js),rust:median(timings.rust),timings,capacityBefore:before,capacityAfter:core.memory.buffer.byteLength});
 }
 return results;
};
</script>`;
let vite,http,url;
test.beforeAll(async()=>{
 vite=await createServer({configFile:false,root:process.cwd(),base:'/inhouse-read/',optimizeDeps:{noDiscovery:true},server:{middlewareMode:true,hmr:false,watch:null},plugins:[pdfImageTrackingPatch(),{name:'pdf-images-fixture',configureServer(server){server.middlewares.use(async(req,res,next)=>{
  if(req.url?.split('?')[0]!=='/inhouse-read/__relief-pigment')return next();
  try{res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml('/inhouse-read/__relief-pigment',html));}catch(e){next(e);}
 });}}]});
 http=createHttpServer(vite.middlewares);await new Promise(r=>http.listen(0,'127.0.0.1',r));url='http://127.0.0.1:'+http.address().port+'/inhouse-read/__relief-pigment';
});
test.afterAll(async()=>{http?.closeAllConnections();if(http)await new Promise(r=>http.close(r));await vite?.close();});
for(const method of ['checkPigments'])test('Rust pigments: '+method,async({page},testInfo)=>{
 test.setTimeout(120_000);const cdp=await page.context().newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
 await page.goto(url);await page.waitForFunction(method=>typeof window[method]==='function',method);
 const result=await page.evaluate(method=>window[method](),method);
 if(Array.isArray(result))for(const row of result)expect(row.capacityAfter).toBe(row.capacityBefore);
 else{expect(result.crops).toBe(32);expect(result.renderedImages).toBe(32);}
 console.log(JSON.stringify(result));await testInfo.attach(method,{body:JSON.stringify(result,null,2),contentType:'application/json'});
});
