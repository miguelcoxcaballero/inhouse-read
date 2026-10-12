import {test,expect} from '@playwright/test';
import {createServer} from 'vite';
import {createServer as createHttpServer} from 'node:http';
import {pdfImageTrackingPatch} from '../../scripts/pdf-image-tracking-patch.mjs';
const html=`<!doctype html><script type="module">
import {loadRustCore} from '/inhouse-read/src/js/rust-core.js';
import {rustPDFImagePaths} from '/inhouse-read/src/js/readers/pdf-images-wasm.js';
import {paintPDFTheme} from '/inhouse-read/src/js/readers/pdf-page-theme.js';
import {referenceImagePaths,referencePaintTheme} from '/inhouse-read/tests/unit/helpers/reference-pdf-image-paths.js';
import {manyImagesPDF} from '/inhouse-read/tests/e2e/fixtures/pdf-many-images.mjs';
import {getDocument,GlobalWorkerOptions} from '/inhouse-read/node_modules/pdfjs-dist/legacy/build/pdf.mjs';
import workerURL from '/inhouse-read/node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
GlobalWorkerOptions.workerSrc=workerURL;
const core=await loadRustCore();if(!core?.pdf_image_paths)throw Error('Actual path kernel required');
window.checkPaths=()=>{
 const results=[];
 for(const count of [1,8,32,128,512,2048]){
  const input=Float32Array.from(Array.from({length:count},(_,i)=>[.1,i/count,.6,i/count+.02,.05,(i+.5)/count]).flat());
  const actual=rustPDFImagePaths(input,400,800),expected=referenceImagePaths(input,400,800);
  if(actual.length!==expected.length||actual.some((n,i)=>!Object.is(n,expected[i])))throw Error('Coordinate mismatch');
  // The old painter never allocated a flattened output. Time its ORIGINAL
  // direct Canvas calls, not the reference-array convenience helper.
  let sink=0;const ctx={clearRect(){},save(){},restore(){},beginPath(){},moveTo(x,y){sink+=x+y;},lineTo(x,y){sink+=x+y;},closePath(){},clip(){},drawImage(){}};
  const target={width:400,height:800,getContext:()=>ctx},source={},run=kind=>(kind==='rust'?paintPDFTheme:referencePaintTheme)(source,target,'sepia(.5)',input);
  for(let i=0;i<8;i++){run('js');run('rust');}
  const capacityBefore=core.memory.buffer.byteLength,timings={js:[],rust:[]};
  for(let round=0;round<9;round++)for(const kind of round%2?['rust','js']:['js','rust']){
   const start=performance.now();for(let i=0;i<100;i++)run(kind);timings[kind].push((performance.now()-start)/100);
  }
  const median=a=>[...a].sort((a,b)=>a-b)[4];results.push({count,js:median(timings.js),rust:median(timings.rust),timings,sink,capacityBefore,capacityAfter:core.memory.buffer.byteLength});
 }
 return results;
};
window.checkPixels=async()=>{
 const loading=getDocument({data:manyImagesPDF(),useSystemFonts:true}),pdf=await loading.promise;
 const make=()=>Object.assign(document.createElement('canvas'),{width:400,height:800});
 try{
  const page=await pdf.getPage(1),source=make(),a=make(),b=make();
  await page.render({canvasContext:source.getContext('2d'),viewport:page.getViewport({scale:1}),recordImages:true}).promise;
  if(page.imageCoordinates.length!==32*6)throw Error('Expected 32 real images');
  const cases=[page.imageCoordinates,Float32Array.from(Array.from({length:32},(_,i)=>{const x=.1+i%4*.18,y=.1+Math.floor(i/4)*.07;return i%2?[x,y,x+.16,y+.02,x-.05,y+.15]:[x,y,x-.05,y+.15,x+.16,y+.02];}).flat())];
  let comparedBytes=0;
  for(const coords of cases)for(const filter of ['none','sepia(.5) brightness(.94)','invert(.89) hue-rotate(180deg)','grayscale(1) invert(1) brightness(.77647)','sepia(.25) hue-rotate(45deg) brightness(.94)']){
   paintPDFTheme(source,a,filter,coords);referencePaintTheme(source,b,filter,coords);
   const left=a.getContext('2d').getImageData(0,0,400,800).data,right=b.getContext('2d').getImageData(0,0,400,800).data;
   for(let i=0;i<left.length;i++)if(left[i]!==right[i])throw Error('Pixel mismatch '+filter+' '+i);
   comparedBytes+=left.length;
  }
  return{comparedBytes,exact:true,images:32,themes:5};
 }finally{await loading.destroy();}
};
</script>`;
let vite,http,url;
test.beforeAll(async()=>{
 vite=await createServer({configFile:false,root:process.cwd(),base:'/inhouse-read/',optimizeDeps:{noDiscovery:true},server:{middlewareMode:true,hmr:false,watch:null},plugins:[pdfImageTrackingPatch(),{name:'pdf-images-fixture',configureServer(server){server.middlewares.use(async(req,res,next)=>{
  if(req.url?.split('?')[0]!=='/inhouse-read/__pdf_paths')return next();
  try{res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml('/inhouse-read/__pdf_paths',html));}catch(e){next(e);}
 });}}]});
 http=createHttpServer(vite.middlewares);await new Promise(r=>http.listen(0,'127.0.0.1',r));url='http://127.0.0.1:'+http.address().port+'/inhouse-read/__pdf_paths';
});
test.afterAll(async()=>{http?.closeAllConnections();if(http)await new Promise(r=>http.close(r));await vite?.close();});
for(const method of ['checkPaths','checkPixels'])test('Rust PDF images: '+method,async({page},testInfo)=>{
 test.setTimeout(60_000);const cdp=await page.context().newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
 await page.goto(url);await page.waitForFunction(method=>typeof window[method]==='function',method);
 const result=await page.evaluate(method=>window[method](),method);
 if(Array.isArray(result))for(const row of result)expect(row.capacityAfter).toBe(row.capacityBefore);
 else{expect(result.exact).toBe(true);expect(result.comparedBytes).toBe(12800000);}
 console.log(JSON.stringify(result));await testInfo.attach(method,{body:JSON.stringify(result,null,2),contentType:'application/json'});
});
