import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {settledGeometryLength} from './helpers/settled-geometry-length.mjs';
if(process.env.IHR_TEST_URL)test.use({baseURL:process.env.IHR_TEST_URL});
const referenceUrl=`data:text/javascript;base64,${(await readFile('tests/unit/helpers/reference-cover-appearance.js')).toString('base64')}`;
test.use({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});
test('published shelf computes and saves the same cover appearance through the real Rust glyph kernel',async({page},info)=>{
 test.setTimeout(90000);const errors=[];page.on('pageerror',error=>errors.push(error.message));
 const bytes=[...await readFile('tests/e2e/fixtures/tiny.pdf')];
 await page.addInitScript(({bytes,geometry})=>{
  window.productionGlyphCalls=0;
  for(const name of ['instantiate','instantiateStreaming'])if(WebAssembly[name]){const original=WebAssembly[name].bind(WebAssembly);WebAssembly[name]=async(...args)=>{const result=await original(...args),instance=result.instance||result,actual=instance.exports;if(!actual.font_glyph_mask)return result;const exports={...actual,font_glyph_mask(...args){window.productionGlyphCalls++;return actual.font_glyph_mask(...args);}};return result.instance?{module:result.module,instance:{exports}}:{exports};};}
  const image=document.createElement('canvas');image.width=360;image.height=540;const c=image.getContext('2d');c.fillStyle='#2f6b4f';c.fillRect(0,0,360,540);c.fillStyle='#fffaf0';c.textAlign='center';c.font='bold 42px Georgia';c.fillText('The Garden',180,110,330);
  window.productionGlyphCover=image.toDataURL('image/png');
  const encoded=atob(window.productionGlyphCover.split(',')[1]),cover=new Blob([Uint8Array.from(encoded,c=>c.charCodeAt(0))],{type:'image/png'});
  const book={id:'rust-glyph-public',title:'The Garden',name:'tiny.pdf',author:'Test',...geometry,format:'PDF',mimeType:'application/pdf',sourceType:'local',content:new Blob([new Uint8Array(bytes)],{type:'application/pdf'}),cover,pageCount:1,shelfOrder:0,addedAt:Date.now(),progressFraction:0};
  const request=indexedDB.open('inhouse-read',2);request.onupgradeneeded=()=>{const db=request.result,books=db.createObjectStore('books',{keyPath:'id'});books.createIndex('lastOpenedAt','lastOpenedAt');db.createObjectStore('removed-books',{keyPath:'id'});books.put(book);};request.onsuccess=()=>request.result.close();
 },{bytes,geometry:settledGeometryLength(90000)});
 await page.goto('./');
 await expect.poll(()=>page.evaluate(()=>window.productionGlyphCalls),{timeout:30000}).toBeGreaterThan(0);
 const stored=()=>page.evaluate(()=>new Promise((resolve,reject)=>{const r=indexedDB.open('inhouse-read',2);r.onerror=()=>reject(r.error);r.onsuccess=()=>{const db=r.result,q=db.transaction('books').objectStore('books').get('rust-glyph-public');q.onsuccess=()=>{resolve(q.result?.coverAppearance??null);db.close();};q.onerror=()=>{reject(q.error);db.close();};};}));
 await expect.poll(async()=>(await stored())?.fontFamily,{timeout:30000}).toBeTruthy();
 const actual=await stored(),expected=await page.evaluate(async url=>{const{analyzeCoverAppearance}=await import(url);return analyzeCoverAppearance(window.productionGlyphCover,'The Garden');},referenceUrl);
 expect(actual).toEqual(expected);expect(actual.source).toBe('cover');expect(actual.color).toBe('#2f6b4f');expect(errors).toEqual([]);
 await info.attach('published-glyph-proof',{body:JSON.stringify({actual,expected,calls:await page.evaluate(()=>window.productionGlyphCalls),url:page.url()},null,2),contentType:'application/json'});
});
