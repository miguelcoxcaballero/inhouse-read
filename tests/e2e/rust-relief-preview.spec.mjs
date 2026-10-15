import {test,expect} from '@playwright/test';
import {createServer} from 'vite';
import {createServer as createHttpServer} from 'node:http';
import {pdfImageTrackingPatch} from '../../scripts/pdf-image-tracking-patch.mjs';
const html=`<!doctype html><script type="module">
import {loadRustCore} from '/inhouse-read/src/js/rust-core.js';
import '/inhouse-read/tests/e2e/helpers/shelf-ready.js';
import {shadePreview} from '/inhouse-read/src/js/cover-relief.js';
import {wasmShadePreview} from '/inhouse-read/src/js/cover-relief-wasm.js';
import {shadePreview as reference} from '/inhouse-read/tests/unit/helpers/reference-relief-preview.js';
const core=await loadRustCore();if(!core?.relief_preview_rows)throw Error('Actual preview core required');
function drain(task){let yields=0;for(;;){const step=task.next();if(step.done)return {out:step.value,yields};yields++;}}
window.checkPreview=()=>{
 const results=[];
 for(const [w,h,mw,mh,preserve] of [[128,192,128,192,false],[288,384,512,512,false],[288,384,512,512,true],[512,512,288,384,true]]){
  let seed=1045;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed>>>24;};
  const image={width:w,height:h,data:Uint8ClampedArray.from({length:w*h*4},random)},maps={width:mw,height:mh,heightMap:Uint8Array.from({length:mw*mh},random),foil:Uint8Array.from({length:mw*mh},random),gloss:Uint8Array.from({length:mw*mh},random),mask:Uint8Array.from({length:mw*mh},()=>random()>90?255:0),preserveInk:preserve};
  const actual=drain(shadePreview(image,maps)),expected=drain(reference(image,maps));
  if(!drain(wasmShadePreview(core,image,maps,7*.6/255*14)).out)throw Error('Native preview fell back');
  if(actual.yields!==expected.yields||actual.out.length!==expected.out.length)throw Error('Shape/safe points differ');for(let i=0;i<expected.out.length;i++)if(actual.out[i]!==expected.out[i])throw Error('RGBA['+i+'] differs');
  const run=type=>drain((type==='rust'?shadePreview:reference)(image,maps));
  for(let i=0;i<3;i++){run('rust');run('js');}
  const before=core.memory.buffer.byteLength,timings={js:[],rust:[]};
  for(let round=0;round<9;round++)for(const type of round%2?['rust','js']:['js','rust']){const start=performance.now();run(type);timings[type].push(performance.now()-start);}
  const median=a=>[...a].sort((a,b)=>a-b)[4];results.push({w,h,mw,mh,preserve,comparedBytes:actual.out.length,yields:actual.yields,js:median(timings.js),rust:median(timings.rust),timings,capacityBefore:before,capacityAfter:core.memory.buffer.byteLength});
 }
 return results;
};
</script>`;
let vite,http,url;
test.beforeAll(async()=>{
 vite=await createServer({configFile:false,root:process.cwd(),base:'/inhouse-read/',optimizeDeps:{noDiscovery:true},server:{middlewareMode:true,hmr:false,watch:null},plugins:[pdfImageTrackingPatch(),{name:'pdf-images-fixture',configureServer(server){server.middlewares.use(async(req,res,next)=>{
  if(req.url?.split('?')[0]!=='/inhouse-read/__relief-preview')return next();
  try{res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml('/inhouse-read/__relief-preview',html));}catch(e){next(e);}
 });}}]});
 http=createHttpServer(vite.middlewares);await new Promise(r=>http.listen(0,'127.0.0.1',r));url='http://127.0.0.1:'+http.address().port+'/inhouse-read/__relief-preview';
});
test.afterAll(async()=>{http?.closeAllConnections();if(http)await new Promise(r=>http.close(r));await vite?.close();});
for(const method of ['checkPreview'])test('Rust preview: '+method,async({page},testInfo)=>{
 test.setTimeout(120_000);const cdp=await page.context().newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
 await page.goto(url);await page.waitForFunction(method=>typeof window[method]==='function',method);
 const result=await page.evaluate(method=>window[method](),method);
 if(Array.isArray(result))for(const row of result)expect(row.capacityAfter).toBe(row.capacityBefore);
 else{expect(result.crops).toBe(32);expect(result.renderedImages).toBe(32);}
 console.log(JSON.stringify(result));await testInfo.attach(method,{body:JSON.stringify(result,null,2),contentType:'application/json'});
});
