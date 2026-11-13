import {test,expect} from '@playwright/test';
import {manyImagesPDF} from './fixtures/pdf-many-images.mjs';
import {referenceImagePaths} from '../unit/helpers/reference-pdf-image-paths.js';
// The compiled reader has no second implementation of the picture footprints: without the kernel it refuses the
// page (core-required.js). The comparison side therefore answers the kernel's own call with the frozen original
// geometry, through the same memory, so the pixels of the original paths are still compared with Rust's.
for(const theme of ['sepia','night','amoled','sage'])test(`compiled PDF theme paths preserve all pixels: ${theme}`,async({browser},testInfo)=>{
 test.setTimeout(120000);const results=[];
 for(const enabled of [false,true]){
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:1});
  try{
   const page=await context.newPage();await page.emulateMedia({reducedMotion:'reduce'});
   await page.addInitScript('window.referenceImagePaths='+referenceImagePaths.toString());
   await page.addInitScript(({enabled,theme})=>{
    localStorage.setItem('inhouse-read-reading-preferences',JSON.stringify({theme}));window.pathProof={available:false,calls:0,reference:0};
    const observe=result=>{const instance=result.instance||result,actual=instance.exports;if(typeof actual?.pdf_image_paths!=='function')return result;
     window.pathProof.available=true;const exports={...actual,pdf_image_paths:enabled?(...args)=>{window.pathProof.calls++;return actual.pdf_image_paths(...args);}:(input,count,width,height,output)=>{
      window.pathProof.reference++;const paths=window.referenceImagePaths(new Float64Array(actual.memory.buffer,input,count*6),width,height);
      new Float64Array(actual.memory.buffer,output,paths.length).set(paths);return paths.length/8;}};
     const proxy=new Proxy(instance,{get(target,key){return key==='exports'?exports:Reflect.get(target,key,target);}});return result.instance?{...result,instance:proxy}:proxy;
    };
    for(const name of ['instantiate','instantiateStreaming'])if(typeof WebAssembly[name]==='function'){const original=WebAssembly[name];WebAssembly[name]=async function(...args){return observe(await Reflect.apply(original,WebAssembly,args));};}
   },{enabled,theme});
   const errors=[];page.on('pageerror',error=>errors.push(error.message));await page.goto(process.env.IHR_TEST_URL||'./');
   await page.waitForFunction(()=>window.pathProof.available);
   await page.locator('#file-picker').setInputFiles({name:'Thirty-two images.pdf',mimeType:'application/pdf',buffer:Buffer.from(manyImagesPDF())});
   await expect(page.locator('#reader-toolbar')).toBeVisible({timeout:60000});await expect(page.locator('.pdf-reader')).toHaveAttribute('aria-busy','false',{timeout:60000});
   const result=await page.locator('.pdf-page-canvas').evaluate(canvas=>{
    const data=canvas.getContext('2d',{willReadFrequently:true}).getImageData(0,0,canvas.width,canvas.height).data;let hash=2166136261;
    for(const byte of data)hash=Math.imul(hash^byte,16777619);
    return {width:canvas.width,height:canvas.height,bytes:data.length,hash:hash>>>0,proof:window.pathProof};
   });
   expect(errors).toEqual([]);expect(result.bytes).toBeGreaterThan(100000);if(enabled){expect(result.proof.calls).toBeGreaterThan(0);expect(result.proof.reference).toBe(0);}else{expect(result.proof.calls).toBe(0);expect(result.proof.reference).toBeGreaterThan(0);}
   results.push(result);
  }finally{await context.close();}
 }
 expect({...results[0],proof:null}).toEqual({...results[1],proof:null});
 await testInfo.attach('compiled-theme-proof',{body:JSON.stringify({theme,results}),contentType:'application/json'});
});
