import {test,expect} from '@playwright/test';
import {createServer} from 'vite';
import {createServer as createHttpServer} from 'node:http';
import {pdfImageTrackingPatch} from '../../scripts/pdf-image-tracking-patch.mjs';
const html=`<!doctype html><script type="module">
import {loadRustCore} from '/inhouse-read/src/js/rust-core.js';
import {paintCloth,seededRandom} from '/inhouse-read/src/js/spine-surface.js';
import {paintCloth as reference,seededRandom as referenceRandom} from '/inhouse-read/tests/unit/helpers/reference-book-cloth.js';
const core=await loadRustCore();if(!core?.book_cloth_plan)throw Error('Actual cloth core required');
window.checkCloth=()=>{
 const results=[];
 for(const [width,metal] of [[80,false],[257.3592701820759,false],[257.3592701820759,true],[512,false]]){
  const canvas=document.createElement('canvas');canvas.width=512;canvas.height=2048;const ctx=canvas.getContext('2d',{willReadFrequently:true});
  const run=type=>{ctx.setTransform(1,0,0,1,0,0);ctx.fillStyle='#2f6b4f';ctx.fillRect(0,0,512,2048);ctx.setTransform(512/width,0,0,2,0,0);const random=(type==='rust'?seededRandom:referenceRandom)(17);(type==='rust'?paintCloth:reference)(ctx,width,random,{metal});ctx.getImageData(0,0,1,1);return random();};
  const next=run('rust'),actual=ctx.getImageData(0,0,512,2048).data,expectedNext=run('js'),expected=ctx.getImageData(0,0,512,2048).data;
  if(next!==expectedNext)throw Error('Random state differs');for(let i=0;i<expected.length;i++)if(actual[i]!==expected[i])throw Error('Canvas byte '+i);
  for(let i=0;i<3;i++){run('rust');run('js');}
  const before=core.memory.buffer.byteLength,timings={js:[],rust:[]};
  for(let round=0;round<9;round++)for(const type of round%2?['rust','js']:['js','rust']){const start=performance.now();for(let i=0;i<5;i++)run(type);timings[type].push((performance.now()-start)/5);}
  const median=a=>[...a].sort((a,b)=>a-b)[4];results.push({width,metal,comparedBytes:actual.length,next,js:median(timings.js),rust:median(timings.rust),timings,capacityBefore:before,capacityAfter:core.memory.buffer.byteLength});
 }
 return results;
};
window.checkProductionCloth=()=>{
 const gpu=document.createElement('canvas').getContext('webgl2');if(!gpu)throw Error('WebGL2 required');
 const texture=gpu.createTexture();gpu.bindTexture(gpu.TEXTURE_2D,texture);gpu.texParameteri(gpu.TEXTURE_2D,gpu.TEXTURE_MIN_FILTER,gpu.LINEAR);gpu.texParameteri(gpu.TEXTURE_2D,gpu.TEXTURE_MAG_FILTER,gpu.LINEAR);
 const results=[];
 try{for(const [width,metal] of [[80,false],[257.3592701820759,false],[257.3592701820759,true],[512,false]]){
  const canvas=document.createElement('canvas');canvas.width=512;canvas.height=2048;const ctx=canvas.getContext('2d');
  // Fresh default Canvas context, no readback. Finish the actual texture upload.
  const run=type=>{ctx.setTransform(1,0,0,1,0,0);ctx.fillStyle='#2f6b4f';ctx.fillRect(0,0,512,2048);ctx.setTransform(512/width,0,0,2,0,0);const random=(type==='rust'?seededRandom:referenceRandom)(17);(type==='rust'?paintCloth:reference)(ctx,width,random,{metal});gpu.texImage2D(gpu.TEXTURE_2D,0,gpu.RGBA,gpu.RGBA,gpu.UNSIGNED_BYTE,canvas);gpu.finish();if(gpu.getError()!==gpu.NO_ERROR)throw Error('Texture upload failed');};
  for(let i=0;i<3;i++){run('rust');run('js');}
  const before=core.memory.buffer.byteLength,timings={js:[],rust:[]};
  for(let round=0;round<9;round++)for(const type of round%2?['rust','js']:['js','rust']){const start=performance.now();for(let i=0;i<5;i++)run(type);timings[type].push((performance.now()-start)/5);}
  const median=a=>[...a].sort((a,b)=>a-b)[4];results.push({width,metal,upload:true,js:median(timings.js),rust:median(timings.rust),timings,capacityBefore:before,capacityAfter:core.memory.buffer.byteLength});
 }}finally{gpu.deleteTexture(texture);gpu.getExtension('WEBGL_lose_context')?.loseContext();}
 return results;
};
window.checkClothPlanCost=()=>{
 const create=document.createElement,results=[];let checksum=0;
 document.createElement=()=>({getContext:()=>({createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)}),putImageData:image=>{checksum+=image.data[0];}})});
 const context={save(){},restore(){},drawImage(){},fillRect(x,y,w,h){checksum+=x+y+w+h;},set fillStyle(value){checksum+=value.length;}};
 try{for(const [width,metal] of [[80,false],[257.3592701820759,false],[257.3592701820759,true],[512,false]]){
  const run=type=>{checksum=0;const random=(type==='rust'?seededRandom:referenceRandom)(17);(type==='rust'?paintCloth:reference)(context,width,random,{metal});return {checksum,next:random()};};
  if(JSON.stringify(run('js'))!==JSON.stringify(run('rust')))throw Error('Plan differs');
  for(let i=0;i<50;i++){run('rust');run('js');}
  const before=core.memory.buffer.byteLength,timings={js:[],rust:[]};
  for(let round=0;round<9;round++)for(const type of round%2?['rust','js']:['js','rust']){const start=performance.now();for(let i=0;i<100;i++)run(type);timings[type].push((performance.now()-start)/100);}
  const median=a=>[...a].sort((a,b)=>a-b)[4];results.push({width,metal,commandsOnly:true,js:median(timings.js),rust:median(timings.rust),timings,capacityBefore:before,capacityAfter:core.memory.buffer.byteLength});
 }}finally{document.createElement=create;}
 return results;
};
</script>`;
let vite,http,url;
test.beforeAll(async()=>{
 vite=await createServer({configFile:false,root:process.cwd(),base:'/inhouse-read/',optimizeDeps:{noDiscovery:true},server:{middlewareMode:true,hmr:false,watch:null},plugins:[pdfImageTrackingPatch(),{name:'pdf-images-fixture',configureServer(server){server.middlewares.use(async(req,res,next)=>{
  if(req.url?.split('?')[0]!=='/inhouse-read/__book-cloth')return next();
  try{res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml('/inhouse-read/__book-cloth',html));}catch(e){next(e);}
 });}}]});
 http=createHttpServer(vite.middlewares);await new Promise(r=>http.listen(0,'127.0.0.1',r));url='http://127.0.0.1:'+http.address().port+'/inhouse-read/__book-cloth';
});
test.afterAll(async()=>{http?.closeAllConnections();if(http)await new Promise(r=>http.close(r));await vite?.close();});
for(const method of ['checkCloth','checkProductionCloth','checkClothPlanCost'])test('Rust cloth: '+method,async({page},testInfo)=>{
 test.setTimeout(120_000);const cdp=await page.context().newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
 await page.goto(url);await page.waitForFunction(method=>typeof window[method]==='function',method);
 const result=await page.evaluate(method=>window[method](),method);
 if(Array.isArray(result))for(const row of result)expect(row.capacityAfter).toBe(row.capacityBefore);
 else{expect(result.crops).toBe(32);expect(result.renderedImages).toBe(32);}
 console.log(JSON.stringify(result));await testInfo.attach(method,{body:JSON.stringify(result,null,2),contentType:'application/json'});
});
