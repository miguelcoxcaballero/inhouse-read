import {test,expect} from '@playwright/test'
import {openCompiledReaderApp} from './helpers/compiled-reader.mjs'
import {waitForFinalBookGeometry} from './helpers/final-book-geometry.mjs'
test.use({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:1})
for(const delayed of [false,true])test('compiled shelf refresh keeps imported bytes and one native queue'+(delayed?' after a pending module':''),async({page},info)=>{
 test.setTimeout(90_000);const errors=[];page.on('pageerror',error=>errors.push(error.message));await page.emulateMedia({reducedMotion:'reduce'});
 await page.addInitScript(()=>{
  localStorage.setItem('inhouse-read-shelf-plants','[]');window.refreshProof={available:false,instances:0,calls:{}};
  const observe=result=>{const instance=result.instance||result,actual=instance.exports;if(!actual.rustshelfrefreshqueue_new)return result;window.refreshProof.available=true;window.refreshProof.instances++;const exports={...actual};for(const name of ['rustshelfrefreshqueue_new','rustshelfrefreshqueue_request','rustshelfrefreshqueue_dispose'])exports[name]=(...args)=>{window.refreshProof.calls[name]=(window.refreshProof.calls[name]||0)+1;return actual[name](...args)};const proxy=new Proxy(instance,{get(target,key){return key==='exports'?exports:Reflect.get(target,key,target)}});return result.instance?{...result,instance:proxy}:proxy};for(const name of ['instantiate','instantiateStreaming'])if(WebAssembly[name]){const original=WebAssembly[name];WebAssembly[name]=async function(...args){return observe(await Reflect.apply(original,WebAssembly,args))}};
 });
 let release;const gate=new Promise(resolve=>{release=resolve}),active=new Set(),pattern=/\/assets\/inhouse_read_ui_bg-[\w-]+\.wasm$/;
 const hold=route=>{const work=(async()=>{await gate;await route.continue()})();active.add(work);work.then(()=>active.delete(work),()=>active.delete(work));return work};if(delayed)await page.route(pattern,hold);
 try{
  const target=process.env.IHR_TEST_URL||'./';if(delayed)await page.goto(target);else await openCompiledReaderApp(page,target);
  await page.locator('#file-picker').setInputFiles('tests/e2e/fixtures/tiny.pdf');
  // The reader has no JavaScript twin: the import waits for the held module (the shelf and its refresh queue are already running on their own).
  if(delayed){await page.waitForTimeout(2500);expect(await page.evaluate(()=>window.refreshProof.available)).toBe(false);release();await page.waitForFunction(()=>window.refreshProof.available)}
  await expect(page.locator('.pdf-page-canvas')).toBeVisible();await waitForFinalBookGeometry(page,'tiny.pdf');
  await page.getByRole('button',{name:'Volver a la estantería'}).click();await expect(page.locator('.ihr-flyout')).toHaveCount(0);await expect(page.locator('.ihr-spine')).toHaveCount(1);
  await page.locator('#file-picker').setInputFiles({name:'refresh-second.pdf',mimeType:'application/pdf',buffer:await (await import('node:fs/promises')).readFile('tests/e2e/fixtures/tiny.pdf')});await expect(page.locator('.pdf-page-canvas')).toBeVisible();await waitForFinalBookGeometry(page,'refresh-second.pdf');await page.getByRole('button',{name:'Volver a la estantería'}).click();await expect(page.locator('.ihr-flyout')).toHaveCount(0);await expect(page.locator('.ihr-spine')).toHaveCount(2);
  const records=await page.evaluate(async()=>{const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('inhouse-read');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});try{const books=await new Promise((resolve,reject)=>{const r=db.transaction('books').objectStore('books').getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});return books.map(b=>({name:b.name,size:b.content?.size,revision:b.contentRevision}))}finally{db.close()}});
  expect(records).toHaveLength(2);for(const record of records){expect(record.size).toBeGreaterThan(0);expect(typeof record.revision).toBe('string')}
  await page.waitForFunction(()=>window.refreshProof.calls.rustshelfrefreshqueue_request>0);const proof=await page.evaluate(()=>window.refreshProof);expect(proof.instances).toBe(1);expect(proof.calls.rustshelfrefreshqueue_new).toBe(1);expect(errors).toEqual([]);await info.attach('compiled-shelf-refresh',{body:JSON.stringify({proof,records},null,2),contentType:'application/json'});
 }finally{release();await Promise.allSettled([...active]);if(delayed&&!page.isClosed())await page.unroute(pattern,hold)}
})
