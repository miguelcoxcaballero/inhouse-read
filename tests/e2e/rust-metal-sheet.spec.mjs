import {test,expect} from '@playwright/test';
import {createServer} from 'vite';
import {createServer as createHttpServer} from 'node:http';
import {pdfImageTrackingPatch} from '../../scripts/pdf-image-tracking-patch.mjs';
const html=`<!doctype html><script type="module">
import {loadRustCore} from '/inhouse-read/src/js/rust-core.js';
import {rustExpandedMetal} from '/inhouse-read/src/js/metal-sheet-wasm.js';
import {expandedMetal as reference} from '/inhouse-read/tests/unit/helpers/reference-metal-sheet.js';
const core=await loadRustCore();if(!core?.metal_sheet_prepare)throw Error('Actual metal core required');
window.checkSheet=()=>{
 const results=[];
 for(const [bounds,kind,z] of [[[0,20,0,20],0,0],[[-283.75,283.75,15,235],0,0],[[24,1140,-100,100],1,-249]]){
  const make=type=>type==='rust'?rustExpandedMetal(...bounds,kind,z,13.2,7.2,.9,.65):reference(...bounds,kind===0?(u,v,n)=>[u,n,-v]:(u,v,n)=>[v,-u,z+n]);
  const expected=make('js'),actual=make('rust');if(!actual)throw Error('Native sheet fell back');let bytes=0;
  for(const name of Object.keys(expected.attributes)){const a=actual.attributes[name].array,b=expected.attributes[name].array;const x=new Uint32Array(a.buffer,a.byteOffset,a.length),y=new Uint32Array(b.buffer,b.byteOffset,b.length);if(x.length!==y.length)throw Error('Vertex count differs');for(let i=0;i<x.length;i++)if(x[i]!==y[i])throw Error(name+'['+i+'] differs');bytes+=a.byteLength;}
  const vertices=actual.attributes.position.count;actual.dispose();expected.dispose();
  const run=type=>{const result=make(type);if(!result)throw Error('Missing sheet');result.dispose();};
  for(let i=0;i<3;i++){run('rust');run('js');}
  const before=core.memory.buffer.byteLength,timings={js:[],rust:[]};
  for(let round=0;round<9;round++)for(const type of round%2?['rust','js']:['js','rust']){const start=performance.now();run(type);timings[type].push(performance.now()-start);}
  const median=a=>[...a].sort((a,b)=>a-b)[4];results.push({bounds,kind,vertices,comparedBytes:bytes,js:median(timings.js),rust:median(timings.rust),timings,capacityBefore:before,capacityAfter:core.memory.buffer.byteLength});
 }
 return results;
};
</script>`;
let vite,http,url;
test.beforeAll(async()=>{
 vite=await createServer({configFile:false,root:process.cwd(),base:'/inhouse-read/',optimizeDeps:{noDiscovery:true},server:{middlewareMode:true,hmr:false,watch:null},plugins:[pdfImageTrackingPatch(),{name:'pdf-images-fixture',configureServer(server){server.middlewares.use(async(req,res,next)=>{
  if(req.url?.split('?')[0]!=='/inhouse-read/__metal-sheet')return next();
  try{res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml('/inhouse-read/__metal-sheet',html));}catch(e){next(e);}
 });}}]});
 http=createHttpServer(vite.middlewares);await new Promise(r=>http.listen(0,'127.0.0.1',r));url='http://127.0.0.1:'+http.address().port+'/inhouse-read/__metal-sheet';
});
test.afterAll(async()=>{http?.closeAllConnections();if(http)await new Promise(r=>http.close(r));await vite?.close();});
for(const method of ['checkSheet'])test('Rust sheet: '+method,async({page},testInfo)=>{
 test.setTimeout(120_000);const cdp=await page.context().newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
 await page.goto(url);await page.waitForFunction(method=>typeof window[method]==='function',method);
 const result=await page.evaluate(method=>window[method](),method);
 if(Array.isArray(result))for(const row of result)expect(row.capacityAfter).toBe(row.capacityBefore);
 else{expect(result.crops).toBe(32);expect(result.renderedImages).toBe(32);}
 console.log(JSON.stringify(result));await testInfo.attach(method,{body:JSON.stringify(result,null,2),contentType:'application/json'});
});
