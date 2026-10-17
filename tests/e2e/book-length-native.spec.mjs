import {test,expect} from '@playwright/test';
import {wordVolumePDF,wordVolumeEPUB} from '../unit/fixtures/book-length-fixtures.mjs';
test.use({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:1});
async function records(page){
 return page.evaluate(async()=>{
  const db=await new Promise((resolve,reject)=>{const request=indexedDB.open('inhouse-read');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
  const all=await new Promise((resolve,reject)=>{const request=db.transaction('books').objectStore('books').getAll();request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});db.close();
  return all.map(({name,wordCount,wordCountComplete,wordCountVersion,contentRevision,wordCountContentRevision,estimatedPageCount,content})=>({name,wordCount,wordCountComplete,wordCountVersion,contentRevision,wordCountContentRevision,estimatedPageCount,bytes:content?.size}));
 });
}
test('real PDF and EPUB imports receive native complete counts and reuse them after a cold reopen',async({page},info)=>{
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(()=>{
  window.__nativeLengthCalls={};
  const observe=result=>{
   const instance=result.instance||result,actual=instance.exports;
   if(typeof actual?.length_measure_file!=='function')return result;
   const exports={...actual};for(const name of ['length_measure_file','length_queue_run'])if(typeof actual[name]==='function')exports[name]=(...args)=>{window.__nativeLengthCalls[name]=(window.__nativeLengthCalls[name]||0)+1;return actual[name](...args);};
   const observed=new Proxy(instance,{get(target,key){return key==='exports'?exports:Reflect.get(target,key,target);}});
   return result.instance?{...result,instance:observed}:observed;
  };
  for(const name of ['instantiate','instantiateStreaming'])if(typeof WebAssembly[name]==='function'){
   const original=WebAssembly[name];WebAssembly[name]=async function(...args){return observe(await Reflect.apply(original,WebAssembly,args));};
  }
 });
 await page.goto('./');await expect(page.locator('.ihr-bookshelf')).toBeVisible();
 const imports=[{name:'native-all-pages.pdf',mimeType:'application/pdf',buffer:wordVolumePDF({words:9000,pages:3}),words:9000},
  {name:'native-all-chapters.epub',mimeType:'application/epub+zip',buffer:wordVolumeEPUB(),words:23}];
 for(const file of imports){
  await page.locator('#file-picker').setInputFiles({name:file.name,mimeType:file.mimeType,buffer:file.buffer});
  await expect(page.locator('#reader-screen')).toBeVisible();
  await expect.poll(async()=>(await records(page)).find(book=>book.name===file.name)?.wordCount).toBe(file.words);
  const book=(await records(page)).find(book=>book.name===file.name);
  expect(book.wordCountComplete).toBe(true);expect(book.wordCountVersion).toBe(2);
  expect(book.wordCountContentRevision).toBe(book.contentRevision);expect(book.contentRevision).toBeTruthy();
  expect(book.estimatedPageCount).toBe(Math.ceil(file.words/300));expect(book.bytes).toBe(file.buffer.length);
  await page.getByRole('button',{name:'Volver a la estantería'}).click();
  await expect(page.locator('body')).not.toHaveClass(/is-closing-reader/);
  await expect(page.locator('.ihr-bookshelf')).toBeVisible();
 }
 const calls=await page.evaluate(()=>window.__nativeLengthCalls);expect(calls.length_measure_file).toBeGreaterThanOrEqual(2);expect(calls.length_queue_run).toBeGreaterThanOrEqual(2);
 const before=await records(page);await page.reload();await expect(page.locator('.ihr-spine')).toHaveCount(2);
 await expect(page.locator('.ihr-bookshelf-scene')).toHaveAttribute('data-animating','false');
 expect(await records(page)).toEqual(before);expect((await page.evaluate(()=>window.__nativeLengthCalls)).length_measure_file||0).toBe(0);
 await info.attach('native-text-counts',{body:JSON.stringify({before,calls}),contentType:'application/json'});
 expect(errors).toEqual([]);
});
