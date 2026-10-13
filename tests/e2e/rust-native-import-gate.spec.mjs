import {installEmptyUpdateChannels} from './helpers/empty-update-channels.mjs'
installEmptyUpdateChannels()
import {test,expect} from '@playwright/test'
import {readFileSync} from 'node:fs'
import {openCompiledReaderApp} from './helpers/compiled-reader.mjs'
import {waitForFinalBookGeometry} from './helpers/final-book-geometry.mjs'
const pdf=[...readFileSync('tests/e2e/fixtures/tiny.pdf')]
test.use({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:1})
for(const delayed of [false,true])test('Android inbox uses Rust shelf gate'+(delayed?' after a cold pending import':''),async({page},info)=>{
 test.setTimeout(90_000);const errors=[];page.on('pageerror',error=>errors.push(error.message));await page.emulateMedia({reducedMotion:'reduce'})
 await page.addInitScript(bytes=>{
  localStorage.setItem('inhouse-read-shelf-plants','[]');window.importGateProof={instances:0,calls:{}};window.importAcks=[]
  const entries=[{id:'first',name:'Gate_First.pdf',mimeType:'application/pdf',size:bytes.length}]
  window.deliverGateBook=()=>entries.push({id:'second',name:'Gate_Second.pdf',mimeType:'application/pdf',size:bytes.length})
  window.InhouseBookImports={pending:()=>JSON.stringify(entries),readChunk:(id,offset)=>btoa(String.fromCharCode(...bytes.slice(offset,offset+64))),acknowledge:id=>{window.importAcks.push(id);entries.splice(0,1)}}
  const observe=result=>{const instance=result.instance||result,actual=instance.exports;if(!actual.rustimportshelfgate_new)return result;window.importGateProof.instances++;const exports={...actual};for(const name of ['rustimportshelfgate_new','rustimportshelfgate_setActive','rustimportshelfgate_deferRefresh'])exports[name]=(...args)=>{window.importGateProof.calls[name]=(window.importGateProof.calls[name]||0)+1;return actual[name](...args)};const proxy=new Proxy(instance,{get(target,key){return key==='exports'?exports:Reflect.get(target,key,target)}});return result.instance?{...result,instance:proxy}:proxy}
  for(const name of ['instantiate','instantiateStreaming'])if(WebAssembly[name]){const original=WebAssembly[name];WebAssembly[name]=async function(...args){return observe(await Reflect.apply(original,WebAssembly,args))}}
 },pdf)
 let release;const pending=new Promise(resolve=>{release=resolve}),active=new Set(),pattern=/\/assets\/inhouse_read_ui_bg-[\w-]+\.wasm$/
 const hold=route=>{const work=(async()=>{await pending;await route.continue()})();active.add(work);work.then(()=>active.delete(work),()=>active.delete(work));return work}
 if(delayed)await page.route(pattern,hold)
 try{
  if(delayed)await page.goto(process.env.IHR_TEST_URL||'./');else await openCompiledReaderApp(page)
  await expect(page.locator('#reader-top-title')).toHaveText('Gate First');await expect(page.locator('.pdf-page-canvas')).toBeVisible();await page.waitForFunction(()=>window.importAcks.length===1);await waitForFinalBookGeometry(page,'Gate_First.pdf')
  if(delayed){expect(await page.evaluate(()=>window.importGateProof.instances)).toBe(0);release();await page.waitForFunction(()=>window.importGateProof.instances===1)}
  await page.getByRole('button',{name:'Volver a la estantería'}).click();await expect(page.locator('.ihr-flyout')).toHaveCount(0);await expect(page.locator('.ihr-spine')).toHaveCount(1)
  await page.evaluate(()=>window.deliverGateBook());await expect(page.locator('#reader-top-title')).toHaveText('Gate Second');await page.waitForFunction(()=>window.importAcks.length===2);await waitForFinalBookGeometry(page,'Gate_Second.pdf')
  await page.getByRole('button',{name:'Volver a la estantería'}).click();await expect(page.locator('.ihr-flyout')).toHaveCount(0);await expect(page.locator('.ihr-spine')).toHaveCount(2)
  const records=await page.evaluate(async()=>{const db=await new Promise(resolve=>{const r=indexedDB.open('inhouse-read');r.onsuccess=()=>resolve(r.result)});try{const books=await new Promise(resolve=>{const r=db.transaction('books').objectStore('books').getAll();r.onsuccess=()=>resolve(r.result)});return Promise.all(books.map(async b=>({name:b.name,bytes:[...new Uint8Array(await b.content.arrayBuffer())]})))}finally{db.close()}})
  expect(records).toHaveLength(2);for(const record of records)expect(record.bytes).toEqual(pdf)
  const proof=await page.evaluate(()=>window.importGateProof);expect(proof.instances).toBe(1);expect(proof.calls.rustimportshelfgate_new).toBe(1);expect(proof.calls.rustimportshelfgate_setActive).toBeGreaterThanOrEqual(2);expect(proof.calls.rustimportshelfgate_deferRefresh).toBeGreaterThan(0);expect(errors).toEqual([])
  await info.attach('native-import-gate',{body:JSON.stringify({proof,records},null,2),contentType:'application/json'})
 }finally{release();await Promise.allSettled([...active]);if(delayed&&!page.isClosed())await page.unroute(pattern,hold)}
})
