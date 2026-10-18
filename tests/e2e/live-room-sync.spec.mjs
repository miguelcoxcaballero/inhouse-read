import {test,expect} from '@playwright/test';
import {driveServer} from './helpers/drive-server.mjs';
import {seedShelf,quietShelf,visibleMiddleBookPoint} from './helpers/reader-layout-fixture.mjs';
const URL=process.env.IHR_TEST_URL||'/inhouse-read/';
const row=page=>page.evaluate(()=>JSON.parse(localStorage.getItem('inhouse-read-shelf-physics-v1')||'null')?.[2]?.find(v=>v[1]===0));
const book=page=>page.evaluate(async()=>{const db=await new Promise(resolve=>{const r=indexedDB.open('inhouse-read');r.onsuccess=()=>resolve(r.result)});const result=await new Promise(resolve=>{const r=db.transaction('books').objectStore('books').getAll();r.onsuccess=()=>resolve(r.result[0])});db.close();return result&&{id:result.id,driveFileId:result.driveFileId,shelfVisualId:result.shelfVisualId,title:result.title,shelfPosition:result.shelfPosition,spineColorOverride:result.spineColorOverride}});

const relay=process.env.IHR_TEST_TURN_URL?{urls:process.env.IHR_TEST_TURN_URL,username:'room-test',credential:'local-fixture-only'}:null;
async function roomProbe(page){
 await page.addInitScript(relay=>{
  const Native=RTCPeerConnection;globalThis.__roomChannels=[];globalThis.__roomPeers=[];
  globalThis.RTCPeerConnection=class extends Native{
   constructor(...args){super(...(relay?[{...args[0],iceServers:[relay],iceTransportPolicy:'relay'}]:args));globalThis.__roomPeers.push(this);this.addEventListener('datachannel',e=>globalThis.__roomChannels.push(e.channel))}
   createDataChannel(...args){const c=super.createDataChannel(...args);globalThis.__roomChannels.push(c);return c}
  }
 },relay)
}

test('mobile and desktop share exact settled book poses and bidirectional edits while open',async({browser},info)=>{
 test.setTimeout(240000);let delayLibrary=false,libraryWrites=0,pendingWrites=0;const drive=driveServer({beforeUpload:async metadata=>{if(metadata.name?.startsWith('library-v1-')){libraryWrites++;pendingWrites++;try{if(delayLibrary)await new Promise(r=>setTimeout(r,5000))}finally{pendingWrites--}}}}),contexts=[],errors=[];
 try{
  const mobile=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true,deviceScaleFactor:1});contexts.push(mobile);await drive.connect(mobile);
  const a=await mobile.newPage();await roomProbe(a);a.on('console',m=>{if(m.text().startsWith('Direct room'))console.log('mobile',m.text())});a.on('pageerror',e=>errors.push(e.message));await a.emulateMedia({reducedMotion:'reduce'});
  await seedShelf(a,{single:true,mode:'isometric'});await quietShelf(a.locator('.ihr-bookshelf-scene'));
  await expect.poll(()=>drive.manifests().some(m=>m.books.length>0&&m.settings['inhouse-read-shelf-physics-v1']),{timeout:30000}).toBe(true);
  const source=await book(a),initial=await row(a);expect(source.driveFileId).toBeTruthy();expect(initial).toBeTruthy();
  const desktop=await browser.newContext({viewport:{width:1000,height:900},hasTouch:true,deviceScaleFactor:1});contexts.push(desktop);await drive.connect(desktop);
  const b=await desktop.newPage();await roomProbe(b);b.on('console',m=>{if(m.text().startsWith('Direct room'))console.log('desktop',m.text())});b.on('pageerror',e=>errors.push(e.message));await b.emulateMedia({reducedMotion:'reduce'});await b.goto(URL);
  await expect(b.locator('.ihr-spine')).toHaveCount(1);await quietShelf(b.locator('.ihr-bookshelf-scene'));
  const restored=await book(b);expect(restored.id).not.toBe(source.id);expect(restored.driveFileId).toBe(source.driveFileId);expect(restored.shelfVisualId).toBe(source.id);
  await expect.poll(async()=>Number(await b.locator('.ihr-spine').getAttribute('data-scene-lean'))).toBeCloseTo(initial[7],3);
  await expect.poll(()=>a.evaluate(()=>globalThis.__roomChannels.some(c=>c.readyState==='open')),{timeout:45000}).toBe(true);
  await expect.poll(()=>b.evaluate(()=>globalThis.__roomChannels.some(c=>c.readyState==='open')),{timeout:10000}).toBe(true);
  delayLibrary=true;
  const point=await visibleMiddleBookPoint(a,[.5,.7,.3]);expect(point).toBeTruthy();const touch=await mobile.newCDPSession(a);
  await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:point.x,y:point.y,id:1}]});
  await expect(a.locator('.ihr-spine')).toHaveClass(/is-lifted/);await expect.poll(async()=>Math.abs(Number(await a.locator('.ihr-spine').getAttribute('data-scene-lean')))).toBeLessThan(.01);
  const direction=initial[7]<0?-1:1,stamp=await a.evaluate(()=>Date.now()/1000);
  for(let i=1;i<=4;i++)await touch.send('Input.dispatchTouchEvent',{type:'touchMove',timestamp:stamp+i*.016,touchPoints:[{x:point.x+direction*i,y:point.y,id:1}]});
  await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',timestamp:stamp+.08,touchPoints:[]});await touch.detach();
  await quietShelf(a.locator('.ihr-bookshelf-scene'));const moved=await row(a);expect(Math.abs(moved[7]-initial[7])).toBeGreaterThan(.3);
  const published=Date.now();
  await expect.poll(async()=>Number(await b.locator('.ihr-spine').getAttribute('data-scene-lean')),{timeout:3000,intervals:[50,100,200]}).toBeCloseTo(moved[7],3);
  const elapsed=Date.now()-published;await quietShelf(b.locator('.ihr-bookshelf-scene'));const received=await row(b);
  expect(received[7]).toBeCloseTo(moved[7],5);for(const i of [0,1])expect(received[3][i]).toBeCloseTo(moved[3][i],4);
  expect(received[5]-received[4][0]).toBeCloseTo(moved[5]-moved[4][0],4);expect(received[6]-received[4][2]).toBeCloseTo(moved[6]-moved[4][2],4);
  const appearanceStart=Date.now();
  await b.evaluate(async()=>{const db=await new Promise(resolve=>{const r=indexedDB.open('inhouse-read');r.onsuccess=()=>resolve(r.result)});let id;const tx=db.transaction('books','readwrite'),store=tx.objectStore('books'),r=store.getAll();r.onsuccess=()=>{id=r.result[0].id;store.put({...r.result[0],spineColorOverride:'#224466'})};await new Promise(resolve=>tx.oncomplete=resolve);db.close();dispatchEvent(new CustomEvent('inhouse-room-book-changed',{detail:{id,fields:['spineColorOverride']}}));dispatchEvent(new Event('inhouse-library-changed'))});
  await expect.poll(async()=>(await book(a))?.spineColorOverride,{timeout:3000,intervals:[50,100,200]}).toBe('#224466');const appearanceMs=Date.now()-appearanceStart;await quietShelf(a.locator('.ihr-bookshelf-scene'));
  expect(Number(await a.locator('.ihr-spine').getAttribute('data-scene-lean'))).toBeCloseTo(moved[7],3);
  await expect.poll(async()=>{const before=libraryWrites;await a.waitForTimeout(2200);return pendingWrites===0&&before===libraryWrites},{timeout:30000,intervals:[200]}).toBe(true);
  await info.attach('live-room-sync',{body:JSON.stringify({mobile:source,desktop:restored,initial,moved,received,propagationMs:elapsed,appearanceMs,libraryWrites}),contentType:'application/json'});
  expect(errors).toEqual([]);
 }finally{
  for(const context of contexts)for(const page of context.pages())if(!page.isClosed())console.log('RTC diagnostics',await page.evaluate(()=>({hidden:document.hidden,channels:globalThis.__roomChannels?.map(c=>c.readyState),peers:globalThis.__roomPeers?.map(p=>({connection:p.connectionState,ice:p.iceConnectionState,signaling:p.signalingState}))})))
  console.log('Mailboxes',[...drive.files.values()].filter(f=>f.name?.startsWith('live-v1-')).map(f=>({name:f.name,signals:Object.keys(JSON.parse(f.bytes).signals),modified:f.modifiedTime})))
  for(const context of contexts)await context.close();}
});
