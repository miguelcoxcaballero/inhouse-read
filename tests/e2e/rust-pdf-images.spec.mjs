import {test,expect} from '@playwright/test';
import {createServer} from 'vite';
import {createServer as createHttpServer} from 'node:http';
import {pdfImageTrackingPatch} from '../../scripts/pdf-image-tracking-patch.mjs';
const html=`<!doctype html><main id="result"></main><script type="module">
import {loadRustCore} from '/inhouse-read/src/js/rust-core.js';
import {rustPDFImageRects} from '/inhouse-read/src/js/readers/pdf-images-wasm.js';
import {pdfImageRects,populatePDFReflow,clearPDFReflow} from '/inhouse-read/src/js/readers/pdf-reflow.js';
import {extractPDFText} from '/inhouse-read/src/js/readers/pdf-text.js';
import {pdfImageRects as reference} from '/inhouse-read/tests/unit/helpers/reference-pdf-images.js';
import {manyImagesPDF} from '/inhouse-read/tests/e2e/fixtures/pdf-many-images.mjs';
import {getDocument,GlobalWorkerOptions} from '/inhouse-read/node_modules/pdfjs-dist/legacy/build/pdf.mjs';
import workerURL from '/inhouse-read/node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
GlobalWorkerOptions.workerSrc=workerURL;
const core=await loadRustCore();if(!core?.pdf_image_rects)throw Error('Actual compiled image bounds required');
window.checkImageBounds=()=>{
 const results=[];
 for(const count of [8,32,128,512,2000]){
  const coordinates=Array.from({length:count},(_,i)=>[0,i/count,.5,i/count,0,(i+.5)/count]).reverse().flat();
  const expected=reference(coordinates,400,count*2),actual=rustPDFImageRects(coordinates,400,count*2);
  if(JSON.stringify(actual)!==JSON.stringify(expected))throw Error('Bounds differ');
  const timings={js:[],rust:[]};for(let i=0;i<5;i++){reference(coordinates,400,count*2);rustPDFImageRects(coordinates,400,count*2);}
  const before=core.memory.buffer.byteLength;
  for(let round=0;round<9;round++)for(const kind of round%2?['rust','js']:['js','rust']){
   const run=kind==='rust'?rustPDFImageRects:reference,start=performance.now();
   for(let i=0;i<20;i++)run(coordinates,400,count*2);timings[kind].push((performance.now()-start)/20);
  }
  const median=a=>[...a].sort((a,b)=>a-b)[4];results.push({count,js:median(timings.js),rust:median(timings.rust),timings,capacityBefore:before,capacityAfter:core.memory.buffer.byteLength});
 }
 return results;
};
window.checkActualIllustrations=async()=>{
 const loading=getDocument({data:manyImagesPDF(),useSystemFonts:true}),pdf=await loading.promise;
 const root=document.querySelector('#result'),source=document.createElement('canvas');
 try{
  const page=await pdf.getPage(1),viewport=page.getViewport({scale:1});source.width=400;source.height=800;
  await page.render({canvasContext:source.getContext('2d'),viewport,recordImages:true}).promise;
  const coords=page.imageCoordinates,expected=reference(coords,400,800),direct=rustPDFImageRects(coords,400,800),rects=pdfImageRects(coords,400,800);
  if(JSON.stringify(direct)!==JSON.stringify(expected)||JSON.stringify(rects)!==JSON.stringify(expected)||rects.length!==32)throw Error('Actual PDF crops differ: '+JSON.stringify({coordinates:coords.length,expected,direct,rects}));
  const layout=extractPDFText(await page.getTextContent(),viewport);populatePDFReflow(root,layout,source,rects,viewport);
  if(root.textContent!==layout.text)throw Error('Text changed around illustrations');
  const images=[...root.querySelectorAll('canvas')];let comparedBytes=0;
  for(let index=0;index<images.length;index++){
   const image=images[index],rect=rects[index];
   if(Math.abs(rect.x0-(20+index%4*96))>1||Math.abs(rect.y0-(70+Math.floor(index/4)*82))>1)throw Error('Image placement moved');
   // Group rendering interpolates source texels. Compare every original
   // composited pixel, rather than assuming every sampled pixel is a pure ink.
   const expectedPixels=source.getContext('2d').getImageData(rect.x0,rect.y0,image.width,image.height).data;
   const actualPixels=image.getContext('2d').getImageData(0,0,image.width,image.height).data;
   for(let i=0;i<expectedPixels.length;i++)if(actualPixels[i]!==expectedPixels[i])throw Error('Original composited pixel changed');
   comparedBytes+=expectedPixels.length;
  }
  return {sourceImages:coords.length/6,crops:rects.length,renderedImages:images.length,comparedBytes,text:root.textContent,originalColours:true};
 }finally{clearPDFReflow(root);source.width=source.height=0;await loading.destroy();}
};
</script>`;
let vite,http,url;
test.beforeAll(async()=>{
 vite=await createServer({configFile:false,root:process.cwd(),base:'/inhouse-read/',optimizeDeps:{noDiscovery:true},server:{middlewareMode:true,hmr:false,watch:null},plugins:[pdfImageTrackingPatch(),{name:'pdf-images-fixture',configureServer(server){server.middlewares.use(async(req,res,next)=>{
  if(req.url?.split('?')[0]!=='/inhouse-read/__pdf_images')return next();
  try{res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml('/inhouse-read/__pdf_images',html));}catch(e){next(e);}
 });}}]});
 http=createHttpServer(vite.middlewares);await new Promise(r=>http.listen(0,'127.0.0.1',r));url='http://127.0.0.1:'+http.address().port+'/inhouse-read/__pdf_images';
});
test.afterAll(async()=>{http?.closeAllConnections();if(http)await new Promise(r=>http.close(r));await vite?.close();});
for(const method of ['checkImageBounds','checkActualIllustrations'])test('Rust PDF images: '+method,async({page},testInfo)=>{
 test.setTimeout(60_000);const cdp=await page.context().newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
 await page.goto(url);await page.waitForFunction(method=>typeof window[method]==='function',method);
 const result=await page.evaluate(method=>window[method](),method);
 if(Array.isArray(result))for(const row of result)expect(row.capacityAfter).toBe(row.capacityBefore);
 else{expect(result.crops).toBe(32);expect(result.renderedImages).toBe(32);}
 console.log(JSON.stringify(result));await testInfo.attach(method,{body:JSON.stringify(result,null,2),contentType:'application/json'});
});
