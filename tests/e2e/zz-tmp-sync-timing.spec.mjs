// TEMPORARY local measurement, never committed.
import {test,expect} from '@playwright/test'
import {driveServer} from './helpers/drive-server.mjs'
import {seedShelf,quietShelf} from './helpers/reader-layout-fixture.mjs'
const URL=process.env.IHR_TEST_URL||'/inhouse-read/'
for(const waitA of [true,false])test('second client first shelf timing waitA='+waitA,async({browser})=>{
 test.setTimeout(240000)
 const drive=driveServer(),contexts=[]
 try{
  const ca=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true});contexts.push(ca)
  const a=await ca.newPage();await seedShelf(a,{single:true});await drive.connect(ca);await a.reload()
  if(waitA){await quietShelf(a.locator('.ihr-bookshelf-scene'));await expect.poll(()=>drive.manifests().some(m=>m.books.length===1&&m.settings['inhouse-read-shelf-physics-v1']),{timeout:60000}).toBe(true)}
  else await expect.poll(()=>drive.manifests().some(m=>m.books.length===1),{timeout:60000}).toBe(true)
  const cb=await browser.newContext({viewport:{width:1240,height:900}});contexts.push(cb);await drive.connect(cb)
  const b=await cb.newPage();const reqs=[];const t0=Date.now()
  b.on('request',r=>{if(r.url().includes('googleapis'))reqs.push([Date.now()-t0,r.method(),r.url().replace(/^https:\/\/www\.googleapis\.com/,'').slice(0,110)])})
  const cdp=await cb.newCDPSession(b);await cdp.send('Profiler.enable');await cdp.send('Profiler.setSamplingInterval',{interval:1000});await cdp.send('Profiler.start')
  await b.goto(URL)
  const marks={}
  await expect.poll(async()=>{const s=await b.evaluate(()=>({spines:document.querySelectorAll('.ihr-spine').length,frame:Number(document.querySelector('.ihr-bookshelf-scene')?.dataset.renderCount||0),prep:(document.querySelector('.ihr-geometry-status,.ihr-preparing,[class*=preparing],[class*=status]')?.className||'')+'|'+(document.body.className)}));
   const extra=await b.evaluate(async()=>{try{const db=await new Promise(r=>{const q=indexedDB.open('inhouse-read');q.onsuccess=()=>r(q.result);q.onerror=()=>r(null)});if(!db||!db.objectStoreNames.contains('books'))return 'nodb';return await new Promise(r=>{const q=db.transaction('books').objectStore('books').getAll();q.onsuccess=()=>r(q.result.map(x=>({id:x.id.slice(0,14),wc:x.wordCountComplete,ls:x.lengthSource,pc:x.pageCount,cov:!!x.cover,ca:!!x.coverAppearance,bytes:x.bytes||x.size,hasContent:!!x.content})))})}catch(e){return String(e)}});const line=JSON.stringify({t:Date.now()-t0,...s,extra});if(line.slice(12)!==globalThis.__last){globalThis.__last=line.slice(12);console.log('TL',line)}
   if(s.frame>0&&!marks.frame)marks.frame=Date.now()-t0;if(s.spines&&!marks.spine)marks.spine=Date.now()-t0;return s.spines},{timeout:120000,intervals:[500]}).toBe(1)
  {const {profile}=await cdp.send('Profiler.stop');(await import('node:fs')).writeFileSync(process.env.PROFILE_OUT,JSON.stringify(profile))}
  await quietShelf(b.locator('.ihr-bookshelf-scene'));marks.quiet=Date.now()-t0
  console.log('SYNC_TIMING',JSON.stringify({waitA,marks,reqs:reqs.filter(r=>r[0]<=marks.spine+200)}))
 }finally{for(const c of contexts)await c.close()}
})
