import {test,expect} from '@playwright/test';
import {driveServer} from './helpers/drive-server.mjs';
import {seedShelf,quietShelf,visibleMiddleBookPoint} from './helpers/reader-layout-fixture.mjs';
const URL=process.env.IHR_TEST_URL||'/inhouse-read/';
const PEER_URL=process.env.IHR_TEST_PEER_URL||URL;
const row=page=>page.evaluate(()=>JSON.parse(localStorage.getItem('inhouse-read-shelf-physics-v1')||'null')?.[2]?.find(v=>v[1]===0));
const book=page=>page.evaluate(async()=>{const db=await new Promise(resolve=>{const r=indexedDB.open('inhouse-read');r.onsuccess=()=>resolve(r.result)});const result=await new Promise(resolve=>{const r=db.transaction('books').objectStore('books').getAll();r.onsuccess=()=>resolve(r.result[0])});db.close();return result&&{id:result.id,driveFileId:result.driveFileId,shelfVisualId:result.shelfVisualId,title:result.title,shelfPosition:result.shelfPosition,spineColorOverride:result.spineColorOverride,progressFraction:result.progressFraction,locator:result.locator,progressUpdatedAt:result.progressUpdatedAt}});

const relay=process.env.IHR_TEST_TURN_URL?{urls:process.env.IHR_TEST_TURN_URL,username:'room-test',credential:'local-fixture-only'}:null;
async function roomProbe(page){
 await page.addInitScript(relay=>{
  const Native=RTCPeerConnection;globalThis.__roomChannels=[];globalThis.__roomPeers=[];globalThis.__roomMotionPackets=[];globalThis.__roomSentMotions=[];
  const watch=c=>{
   const record=(target,data)=>{if(typeof data!=='string')return;try{const value=JSON.parse(data);if(value.t==='room-motion'){target.push({at:Date.now(),value});if(target.length>256)target.shift()}}catch{}};
   c.addEventListener('message',e=>record(globalThis.__roomMotionPackets,e.data));const send=c.send.bind(c);c.send=data=>{record(globalThis.__roomSentMotions,data);return send(data)};return c;
  };
  globalThis.RTCPeerConnection=class extends Native{
   constructor(...args){super(...(relay?[{...args[0],iceServers:[relay],iceTransportPolicy:'relay'}]:args));globalThis.__roomPeers.push(this);this.addEventListener('datachannel',e=>globalThis.__roomChannels.push(watch(e.channel)))}
   createDataChannel(...args){const c=super.createDataChannel(...args);globalThis.__roomChannels.push(watch(c));return c}
  }
 },relay)
}

test('mobile and desktop stream held-book movement and converge poses and reading progress while open',async({browser},info)=>{
 test.setTimeout(240000);let delayLibrary=false,libraryWrites=0,pendingWrites=0;const drive=driveServer({beforeUpload:async metadata=>{if(metadata.name?.startsWith('library-v1-')){libraryWrites++;pendingWrites++;try{if(delayLibrary)await new Promise(r=>setTimeout(r,5000))}finally{pendingWrites--}}}}),contexts=[],errors=[];
 try{
  const mobile=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true,deviceScaleFactor:1});contexts.push(mobile);await drive.connect(mobile);
  const a=await mobile.newPage();await roomProbe(a);a.on('console',m=>{if(m.text().startsWith('Direct room'))console.log('mobile',m.text())});a.on('pageerror',e=>errors.push(e.message));await a.emulateMedia({reducedMotion:'reduce'});
  await seedShelf(a,{single:true,mode:'isometric',bookFile:'reading-journey.pdf'});await quietShelf(a.locator('.ihr-bookshelf-scene'));
  await expect.poll(()=>drive.manifests().some(m=>m.books.length>0&&m.settings['inhouse-read-shelf-physics-v1']),{timeout:30000}).toBe(true);
  const source=await book(a),initial=await row(a);expect(source.driveFileId).toBeTruthy();expect(initial).toBeTruthy();
  const desktop=await browser.newContext({viewport:{width:1000,height:900},hasTouch:true,deviceScaleFactor:1});contexts.push(desktop);await drive.connect(desktop);
  const b=await desktop.newPage();await roomProbe(b);b.on('console',m=>{if(m.text().startsWith('Direct room'))console.log('desktop',m.text())});b.on('pageerror',e=>errors.push(e.message));await b.emulateMedia({reducedMotion:'reduce'});await b.goto(PEER_URL);
  await expect(b.locator('.ihr-spine')).toHaveCount(1);await quietShelf(b.locator('.ihr-bookshelf-scene'));
  const restored=await book(b);expect(restored.id).not.toBe(source.id);expect(restored.driveFileId).toBe(source.driveFileId);expect(restored.shelfVisualId).toBe(source.id);
  await expect.poll(async()=>Number(await b.locator('.ihr-spine').getAttribute('data-scene-lean'))).toBeCloseTo(initial[7],3);
  await expect.poll(()=>a.evaluate(()=>globalThis.__roomChannels.some(c=>c.readyState==='open')),{timeout:45000}).toBe(true);
  await expect.poll(()=>b.evaluate(()=>globalThis.__roomChannels.some(c=>c.readyState==='open')),{timeout:10000}).toBe(true);
  delayLibrary=true;
  const point=await visibleMiddleBookPoint(a,[.5,.7,.3]);expect(point).toBeTruthy();const touch=await mobile.newCDPSession(a);
  await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:point.x,y:point.y,id:1}]});
  await expect(a.locator('.ihr-spine')).toHaveClass(/is-lifted/);await expect.poll(async()=>Math.abs(Number(await a.locator('.ihr-spine').getAttribute('data-scene-lean')))).toBeLessThan(.01);
  await expect.poll(async()=>Math.abs(Number(await b.locator('.ihr-spine').getAttribute('data-scene-lean'))),{timeout:3000,intervals:[30,50,100]}).toBeLessThan(.01);
  await b.waitForTimeout(500);
  const stillCount=await b.locator('.ihr-bookshelf-scene').getAttribute('data-snapshot-render-count');
  await b.waitForTimeout(4300); // A motionless finger must keep its lease without a GPU render loop.
  expect(Math.abs(Number(await b.locator('.ihr-spine').getAttribute('data-scene-lean')))).toBeLessThan(.01);
  expect(await b.locator('.ihr-bookshelf-scene').getAttribute('data-snapshot-render-count')).toBe(stillCount);
  await expect(a.locator('.ihr-spine')).toHaveClass(/is-lifted/);
  const heldBefore=await b.locator('.ihr-spine').boundingBox();
  const direction=initial[7]<0?-1:1,stamp=await a.evaluate(()=>Date.now()/1000);
  for(let i=1;i<=8;i++)await touch.send('Input.dispatchTouchEvent',{type:'touchMove',timestamp:stamp+i*.016,touchPoints:[{x:point.x+direction*i*3,y:point.y,id:1}]});
  const liveStarted=Date.now();
  try { await expect.poll(async()=>b.locator('.ihr-spine').boundingBox().then(p=>Math.hypot(p.x-heldBefore.x,p.y-heldBefore.y)),{timeout:3000,intervals:[30,50,100]}).toBeGreaterThan(3) }
  catch(error){
    for(const [name,page]of [['source',a],['target',b]])await info.attach(name+'-motion-state',{body:JSON.stringify(await page.evaluate(()=>({node:document.querySelector('.ihr-spine')?.className,rect:document.querySelector('.ihr-spine')?.getBoundingClientRect().toJSON(),sent:globalThis.__roomSentMotions?.slice(-6),received:globalThis.__roomMotionPackets?.slice(-6),canvas:document.querySelector('.ihr-bookshelf-scene')?.dataset}))),contentType:'application/json'});
    throw error;
  }
  const sentMotion=await a.evaluate(()=>globalThis.__roomSentMotions.at(-1));
  await expect.poll(()=>b.evaluate(seq=>globalThis.__roomMotionPackets.some(p=>p.value.sequence===seq),sentMotion.value.sequence),{timeout:1500,intervals:[20,50,100]}).toBe(true);
  const wireMotion=await b.evaluate(seq=>globalThis.__roomMotionPackets.find(p=>p.value.sequence===seq),sentMotion.value.sequence);
  const heldAfter=await b.locator('.ihr-spine').boundingBox(),heldPropagationMs=Date.now()-liveStarted;
  await expect(a.locator('.ihr-spine')).toHaveClass(/is-dragging/);
  await info.attach('held-motion-desktop',{body:await b.screenshot(),contentType:'image/png'});
  await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',timestamp:stamp+.16,touchPoints:[]});await touch.detach();
  await quietShelf(a.locator('.ihr-bookshelf-scene'));const moved=await row(a);expect(Math.abs(moved[7]-initial[7])).toBeGreaterThan(.3);
  const published=Date.now();
  await expect.poll(async()=>Number(await b.locator('.ihr-spine').getAttribute('data-scene-lean')),{timeout:3000,intervals:[50,100,200]}).toBeCloseTo(moved[7],3);
  const elapsed=Date.now()-published;await quietShelf(b.locator('.ihr-bookshelf-scene'));const received=await row(b);
  const sourceAtReceive=await row(a);await info.attach('settled-room-pair',{body:JSON.stringify({moved,sourceAtReceive,received}),contentType:'application/json'});
  expect(received[7]).toBeCloseTo(sourceAtReceive[7],5);for(const i of [0,1])expect(received[3][i]).toBeCloseTo(moved[3][i],4);
  expect(received[5]-received[4][0]).toBeCloseTo(moved[5]-moved[4][0],4);expect(received[6]-received[4][2]).toBeCloseTo(moved[6]-moved[4][2],4);
  const appearanceStart=Date.now();
  await b.evaluate(async()=>{const db=await new Promise(resolve=>{const r=indexedDB.open('inhouse-read');r.onsuccess=()=>resolve(r.result)});let id;const tx=db.transaction('books','readwrite'),store=tx.objectStore('books'),r=store.getAll();r.onsuccess=()=>{id=r.result[0].id;store.put({...r.result[0],spineColorOverride:'#224466'})};await new Promise(resolve=>tx.oncomplete=resolve);db.close();dispatchEvent(new CustomEvent('inhouse-room-book-changed',{detail:{id,fields:['spineColorOverride']}}));dispatchEvent(new Event('inhouse-library-changed'))});
  await expect.poll(async()=>(await book(a))?.spineColorOverride,{timeout:3000,intervals:[50,100,200]}).toBe('#224466');const appearanceMs=Date.now()-appearanceStart;await quietShelf(a.locator('.ihr-bookshelf-scene'));
  expect(Number(await a.locator('.ihr-spine').getAttribute('data-scene-lean'))).toBeCloseTo(moved[7],3);
  const openReader=async page=>{
    const p=await visibleMiddleBookPoint(page,[.5,.7,.3]);expect(p).toBeTruthy();
    await page.touchscreen.tap(p.x,p.y);await expect(page.locator('.ihr-flyout.is-ready')).toBeVisible();
    await page.locator('.ihr-flyout__cover-target').click();await expect(page.locator('#reader-location')).toHaveAttribute('aria-label',/de 4/);
  };
  await openReader(a);await a.locator('#reader-location').click();
  await a.getByRole('spinbutton',{name:'Ir a la página'}).fill('4');await a.getByRole('button',{name:'Ir',exact:true}).click();
  await expect(a.locator('#reader-location')).toHaveAttribute('aria-label',/Página 4 de 4/);
  await expect.poll(async()=>(await book(b))?.progressFraction,{timeout:3000,intervals:[50,100,200]}).toBe(1);
  const pageFour=await book(b);expect(pageFour.locator).toBeTruthy();
  await openReader(b);await expect(b.locator('#reader-location')).toHaveAttribute('aria-label',/Página 4 de 4/);
  await b.locator('#reader-location').click();await b.getByRole('spinbutton',{name:'Ir a la página'}).fill('2');await b.getByRole('button',{name:'Ir',exact:true}).click();
  await expect(b.locator('#reader-location')).toHaveAttribute('aria-label',/Página 2 de 4/);
  const localReading=await book(b);
  await expect.poll(async()=>(await book(a))?.progressFraction,{timeout:3000,intervals:[50,100,200]}).toBe(localReading.progressFraction);
  const remoteReading=await book(a);expect(remoteReading.locator).toEqual(localReading.locator);
  // Closing the first reader at its unchanged page four must not undo page two from b.
  await a.locator('#reader-back').click();await quietShelf(a.locator('.ihr-bookshelf-scene'));
  expect((await book(a)).progressFraction).toBe(localReading.progressFraction);
  await b.locator('#reader-back').click();await quietShelf(b.locator('.ihr-bookshelf-scene'));
  expect((await book(b)).locator).toEqual(localReading.locator);
  // An actually broken RTC route must recover without another book edit.
  delayLibrary=false;
  await b.evaluate(()=>{for(const peer of globalThis.__roomPeers)if(peer.connectionState==='connected')peer.close()});
  await expect.poll(()=>b.evaluate(()=>globalThis.__roomPeers.some(p=>p.connectionState==='connected')),{timeout:45000}).toBe(true);
  expect((await book(a)).locator).toEqual((await book(b)).locator);
  await expect.poll(async()=>{const before=libraryWrites;await a.waitForTimeout(2200);return pendingWrites===0&&before===libraryWrites},{timeout:30000,intervals:[200]}).toBe(true);
  await info.attach('live-room-sync',{body:JSON.stringify({mobile:source,desktop:restored,initial,moved,received,propagationMs:elapsed,appearanceMs,heldPropagationMs,sourceAtReceive,wireLatencyMs:wireMotion.at-sentMotion.at,heldBefore,heldAfter,remoteReading,localReading,libraryWrites}),contentType:'application/json'});
  expect(errors).toEqual([]);
 }finally{
  for(const context of contexts)for(const page of context.pages())if(!page.isClosed())console.log('RTC diagnostics',await page.evaluate(()=>({hidden:document.hidden,channels:globalThis.__roomChannels?.map(c=>c.readyState),peers:globalThis.__roomPeers?.map(p=>({connection:p.connectionState,ice:p.iceConnectionState,signaling:p.signalingState}))})))
  console.log('Mailboxes',[...drive.files.values()].filter(f=>f.name?.startsWith('live-v1-')).map(f=>({name:f.name,signals:Object.keys(JSON.parse(f.bytes).signals),modified:f.modifiedTime})))
  for(const context of contexts)await context.close();}
});

test('duplicate local tabs stream the held book even when RTC cannot open',async({browser},info)=>{
 test.setTimeout(120000);const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true});const drive=driveServer();await drive.connect(context)
 // Leave the actual app/BC/crypto/storage intact, but make a network route unavailable.
 await context.addInitScript(()=>{globalThis.RTCPeerConnection=class{constructor(){throw Error('Local-tab RTC unavailable fixture')}}})
 try{
  const a=await context.newPage();await a.emulateMedia({reducedMotion:'reduce'});await seedShelf(a,{single:true});
  await expect.poll(()=>drive.manifests().some(m=>m.books.length>0),{timeout:30000}).toBe(true)
  const b=await context.newPage();await b.emulateMedia({reducedMotion:'reduce'});await b.goto(URL);await expect(b.locator('.ihr-spine')).toHaveCount(1);await quietShelf(b.locator('.ihr-bookshelf-scene'))
  const p=await visibleMiddleBookPoint(a),touch=await context.newCDPSession(a);expect(p).toBeTruthy()
  await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:p.x,y:p.y,id:1}]});await expect(a.locator('.ihr-spine')).toHaveClass(/is-lifted/)
  await expect.poll(async()=>Math.abs(Number(await b.locator('.ihr-spine').getAttribute('data-scene-lean'))),{timeout:3000}).toBeLessThan(.01)
  const before=await b.locator('.ihr-spine').boundingBox()
  for(let i=1;i<=8;i++)await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:p.x+i*3,y:p.y,id:1}]})
  await expect.poll(async()=>b.locator('.ihr-spine').boundingBox().then(p=>Math.hypot(p.x-before.x,p.y-before.y)),{timeout:3000}).toBeGreaterThan(3)
  await expect(a.locator('.ihr-spine')).toHaveClass(/is-dragging/)
  await info.attach('same-origin-held-preview',{body:await b.screenshot(),contentType:'image/png'})
  await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await touch.detach()
  await quietShelf(a.locator('.ihr-bookshelf-scene'));await quietShelf(b.locator('.ihr-bookshelf-scene'))
 }finally{await context.close()}
})
