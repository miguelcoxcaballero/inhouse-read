import {test,expect} from '@playwright/test';
import {createServer} from 'vite';
import {createServer as createHttpServer} from 'node:http';
const html=`<!doctype html><script type="module">
import {loadRustCore} from '/inhouse-read/src/js/rust-core.js';
import {rustPrepareCoverPixels} from '/inhouse-read/src/js/font-glyph-wasm.js';
import {referencePrepare} from '/inhouse-read/tests/unit/helpers/reference-cover-preparation.js';
const core=await loadRustCore();if(!core?.font_prepare_pixels)throw Error('Actual cover preparation required');
window.checkPreparation=()=>{
 const result=[];for(const [width,height,edges] of [[1,1,false],[12,12,false],[80,66,true],[128,192,true],[192,288,true],[192,288,false],[512,512,true]]){
  let s=17;const raw=Uint8ClampedArray.from({length:width*height*4},()=>{s=(Math.imul(s,1664525)+1013904223)>>>0;return s>>>24;});
  const run=kind=>kind==='rust'?rustPrepareCoverPixels(core,raw,width,height,edges):referencePrepare(raw,width,height,edges);const a=run('rust'),b=run('js');if(a.busy!==b.busy)throw Error('Classification');
  let comparedBytes=0;for(const key of ['gray','near']){if(a[key]===null&&b[key]===null)continue;const x=new Uint8Array(a[key].buffer,a[key].byteOffset,a[key].byteLength),y=new Uint8Array(b[key].buffer,b[key].byteOffset,b[key].byteLength);if(x.length!==y.length)throw Error(key+' length');for(let i=0;i<x.length;i++)if(x[i]!==y[i])throw Error(key+' byte '+i);comparedBytes+=x.length;}
  for(let i=0;i<10;i++){run('rust');run('js');}const capacityBefore=core.memory.buffer.byteLength,timings={js:[],rust:[]},iterations=width<20?1000:30;
  for(let round=0;round<9;round++)for(const kind of round%2?['rust','js']:['js','rust']){const start=performance.now();for(let i=0;i<iterations;i++)run(kind);timings[kind].push((performance.now()-start)/iterations);}
  const median=a=>[...a].sort((a,b)=>a-b)[4];result.push({width,height,edges,comparedBytes,js:median(timings.js),rust:median(timings.rust),timings,capacityBefore,capacityAfter:core.memory.buffer.byteLength});
 }return result;
};
</script>`;
let vite,http,url;
test.beforeAll(async()=>{vite=await createServer({configFile:false,root:process.cwd(),base:'/inhouse-read/',optimizeDeps:{noDiscovery:true},server:{middlewareMode:true,hmr:false,watch:null},plugins:[{name:'prepare-fixture',configureServer(server){server.middlewares.use(async(req,res,next)=>{if(req.url?.split('?')[0]!=='/inhouse-read/__prepare')return next();try{res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml('/inhouse-read/__prepare',html));}catch(e){next(e);}});}}]});http=createHttpServer(vite.middlewares);await new Promise(r=>http.listen(0,'127.0.0.1',r));url='http://127.0.0.1:'+http.address().port+'/inhouse-read/__prepare';});
test.afterAll(async()=>{http?.closeAllConnections();if(http)await new Promise(r=>http.close(r));await vite?.close();});
test('Rust grayscale and edge preparation preserves each byte including NaN borders',async({page},info)=>{test.setTimeout(120000);const cdp=await page.context().newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});await page.goto(url);await page.waitForFunction(()=>typeof window.checkPreparation==='function',null,{timeout:15000});const result=await page.evaluate(()=>window.checkPreparation());expect(result).toHaveLength(7);for(const row of result)expect(row.capacityAfter).toBe(row.capacityBefore);console.log(JSON.stringify(result));await info.attach('preparation-cost',{body:JSON.stringify(result,null,2),contentType:'application/json'});});
