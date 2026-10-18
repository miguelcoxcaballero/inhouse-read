import {paintedRoomProbe,paintedRoom} from './helpers/painted-room-probe.mjs';
import {test,expect} from '@playwright/test';
import {driveServer} from './helpers/drive-server.mjs';
import {seedShelf,quietShelf,visibleMiddleBookPoint} from './helpers/reader-layout-fixture.mjs';
import {roomProbe} from './helpers/live-room-probe.mjs';
const URL=process.env.IHR_TEST_URL||'/inhouse-read/';
async function state(page){return page.evaluate(async()=>{
 const db=await new Promise(resolve=>{const r=indexedDB.open('inhouse-read');r.onsuccess=()=>resolve(r.result)});
 const books=await new Promise(resolve=>{const r=db.transaction('books').objectStore('books').getAll();r.onsuccess=()=>resolve(r.result)});db.close();
 const ids=new Map(books.map(b=>['book:'+b.id,'book:drive:'+b.driveFileId]));
 const raw=JSON.parse(localStorage.getItem('inhouse-read-shelf-physics-v1')||'null');
 return {trace:globalThis.__roomSavedTrace,books:books.map(b=>({id:b.id,drive:b.driveFileId,position:b.shelfPosition})),poses:raw?.[2]?.map(r=>({key:ids.get(r[0])||r[0],bay:r[2][2],size:r[3],bounds:[r[4][1]-r[4][0],r[4][3]-r[4][2]],x:r[5]-r[4][0],y:r[6]-r[4][2],angle:r[7],solid:r[8]})),canvas:document.querySelector('.ihr-bookshelf-scene')?.dataset,connected:globalThis.__roomPeers?.some(p=>p.connectionState==='connected')};
})}
async function watchScene(page){await page.evaluate(()=>{
 globalThis.__originalRoom=document.querySelector('.ihr-bookshelf');globalThis.__originalCanvas=document.querySelector('.ihr-bookshelf-scene');globalThis.__roomDetachments=0;
 new MutationObserver(()=>{if(!globalThis.__originalRoom.isConnected||!globalThis.__originalCanvas.isConnected)globalThis.__roomDetachments++}).observe(document.body,{subtree:true,childList:true});
})}
function samePoses(a,b){
 if(!a?.poses||!b?.poses||a.poses.length!==b.poses.length)return false;
 return a.poses.every(p=>{const q=b.poses.find(q=>q.key===p.key);return q&&p.bay===q.bay&&['x','y','angle'].every(k=>Math.abs(p[k]-q[k])<.0002)&&p.size.every((v,i)=>Math.abs(v-q.size[i])<.0002)});
}
async function samePaint(a,b,count=8){
 const source=await paintedRoom(a),remote=await paintedRoom(b),keys=Object.keys(source);
 if(keys.length!==count)return 1;
 return Math.max(...keys.map(key=>!remote[key]?1:Math.max(...source[key].paint.map((v,i)=>Math.abs(v-remote[key].paint[i])))));
}
test('full mobile room stays identical in Chrome across OAuth clients, live gestures and remote commits',async({browser},info)=>{
 test.setTimeout(240000);const drive=driveServer({privateAppProperties:true}),contexts=[],errors=[];let a,b;
 try{
  const mobile=await browser.newContext({serviceWorkers:'block',viewport:{width:390,height:844},hasTouch:true,isMobile:true,deviceScaleFactor:1});contexts.push(mobile);a=await mobile.newPage();await roomProbe(a);await paintedRoomProbe(a);a.on('pageerror',e=>errors.push(e.message));
  await seedShelf(a);await drive.connect(mobile);await a.reload();await quietShelf(a.locator('.ihr-bookshelf-scene'));await expect.poll(()=>drive.manifests().some(m=>m.books.length===6&&m.settings['inhouse-read-shelf-physics-v1']),{timeout:30000}).toBe(true);
  const desktop=await browser.newContext({serviceWorkers:'block',viewport:{width:1240,height:900},deviceScaleFactor:1});contexts.push(desktop);await drive.connect(desktop);b=await desktop.newPage();await roomProbe(b);await paintedRoomProbe(b);b.on('pageerror',e=>errors.push(e.message));await b.goto(URL);
  await expect(b.locator('.ihr-spine')).toHaveCount(6);await expect(b.locator('.ihr-plant')).toHaveCount(1);await expect(b.locator('.ihr-lamp')).toHaveCount(1);
  await quietShelf(a.locator('.ihr-bookshelf-scene'));await quietShelf(b.locator('.ihr-bookshelf-scene'));
  await info.attach('initial-painted-pair',{body:JSON.stringify({a:await paintedRoom(a),b:await paintedRoom(b)}),contentType:'application/json'});
  await info.attach('initial-room-pair',{body:JSON.stringify({a:await state(a),b:await state(b)}),contentType:'application/json'});
  await expect.poll(async()=>samePoses(await state(a),await state(b)),{timeout:15000}).toBe(true);
  await expect.poll(()=>samePaint(a,b),{timeout:15000}).toBeLessThan(.00001);
  await expect.poll(()=>b.evaluate(()=>__roomChannels.some(c=>c.label==='inhouse-read-interactive-v1'&&c.readyState==='open')),{timeout:30000}).toBe(true);
  await watchScene(b);
  const point=await visibleMiddleBookPoint(a,[.5,.7,.3],2);expect(point).toBeTruthy();
  const record=(await state(a)).books.find(x=>x.id===point.id),remote=(await state(b)).books.find(x=>x.drive===record.drive);
  const target=b.locator(`.ihr-spine[data-book-id="${remote.id}"]`),touch=await mobile.newCDPSession(a);
  await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:point.x,y:point.y,id:1}]});await expect(a.locator(`.ihr-spine[data-book-id="${point.id}"]`)).toHaveClass(/is-lifted/);
  // The full lit room compiles shaders under software GPU rendering. The
  // single-book regression measures latency; this checks delivery while held.
  await expect.poll(()=>b.evaluate(()=>__roomMotionPackets.length),{timeout:15000}).toBeGreaterThan(0);
  await b.waitForTimeout(300);const before=await target.boundingBox();
  for(let i=1;i<=8;i++)await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:point.x+i*3,y:point.y,id:1}]});
  await expect.poll(async()=>{const p=await target.boundingBox();return Math.hypot(p.x-before.x,p.y-before.y)},{timeout:15000}).toBeGreaterThan(3);
  await expect(a.locator(`.ihr-spine[data-book-id="${point.id}"]`)).toHaveClass(/is-dragging/);
  await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await touch.detach();
  await quietShelf(a.locator('.ihr-bookshelf-scene'));await quietShelf(b.locator('.ihr-bookshelf-scene'));
  await expect.poll(async()=>samePoses(await state(a),await state(b)),{timeout:10000}).toBe(true);
  expect(await b.evaluate(()=>({root:__originalRoom===document.querySelector('.ihr-bookshelf'),canvas:__originalCanvas===document.querySelector('.ihr-bookshelf-scene'),detachments:__roomDetachments}))).toEqual({root:true,canvas:true,detachments:0});
  await a.evaluate(()=>{const key='inhouse-read-shelf-lamps',lamps=JSON.parse(localStorage.getItem(key));lamps[0].isOn=false;localStorage.setItem(key,JSON.stringify(lamps));dispatchEvent(new StorageEvent('storage',{key,storageArea:localStorage}));dispatchEvent(new CustomEvent('inhouse-room-setting-changed',{detail:key}));});
  await expect(b.locator('.ihr-lamp')).toHaveAttribute('data-lamp-on','false');await quietShelf(b.locator('.ihr-bookshelf-scene'));
  expect(await b.evaluate(()=>__originalCanvas===document.querySelector('.ihr-bookshelf-scene')&&__roomDetachments===0)).toBe(true);
  await expect.poll(async()=>samePoses(await state(a),await state(b)),{timeout:15000}).toBe(true);
  await expect.poll(()=>samePaint(a,b),{timeout:15000}).toBeLessThan(.00001);
  await b.setViewportSize({width:680,height:790});await quietShelf(b.locator('.ihr-bookshelf-scene'));
  await expect.poll(()=>samePaint(a,b),{timeout:5000}).toBeLessThan(.00001);
  await b.reload();await expect(b.locator('.ihr-spine')).toHaveCount(6);await quietShelf(b.locator('.ihr-bookshelf-scene'));
  await expect.poll(async()=>samePoses(await state(a),await state(b)),{timeout:15000}).toBe(true);
  await expect.poll(()=>samePaint(a,b),{timeout:15000}).toBeLessThan(.00001);expect(errors).toEqual([]);
 }finally{
  await info.attach('errors',{body:JSON.stringify(errors),contentType:'application/json'});
  for(const [name,p]of [['mobile',a],['desktop',b]])if(p&&!p.isClosed()){
   await info.attach(name+'-painted',{body:JSON.stringify(await paintedRoom(p)),contentType:'application/json'});await info.attach(name+'-state',{body:JSON.stringify(await state(p)),contentType:'application/json'});await info.attach(name+'-screen',{body:await p.screenshot(),contentType:'image/png'});
  }
  for(const c of contexts)await c.close();
 }
});

test('different installations receive held movement through encrypted Drive when RTC is blocked',async({browser},info)=>{
 test.setTimeout(150000);const drive=driveServer({privateAppProperties:true}),contexts=[];
 const samples=[];
 try{
  const make=async (viewport,connect=true)=>{const context=await browser.newContext({serviceWorkers:'block',viewport,hasTouch:true,isMobile:viewport.width<500});contexts.push(context);if(connect)await drive.connect(context);
   await context.addInitScript(()=>{globalThis.RTCPeerConnection=class{constructor(){throw Error('Blocked network fixture')}}});
   const page=await context.newPage();await paintedRoomProbe(page);await page.emulateMedia({reducedMotion:'reduce'});return page};
  const a=await make({width:390,height:844},false);await seedShelf(a,{single:true});await drive.connect(contexts[0]);await a.reload();await quietShelf(a.locator('.ihr-bookshelf-scene'));await expect.poll(()=>drive.manifests().some(m=>m.books.length===1),{timeout:30000}).toBe(true);
  const b=await make({width:1000,height:900});await b.goto(URL);await expect(b.locator('.ihr-spine')).toHaveCount(1);await quietShelf(b.locator('.ihr-bookshelf-scene'));
  await watchScene(b);const p=await visibleMiddleBookPoint(a),touch=await contexts[0].newCDPSession(a);expect(p).toBeTruthy();
  await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:p.x,y:p.y,id:1}]});await expect(a.locator('.ihr-spine')).toHaveClass(/is-lifted/);
  await expect.poll(async()=>Math.abs(Number(await b.locator('.ihr-spine').getAttribute('data-scene-lean'))),{timeout:8000}).toBeLessThan(.01);
  const before=await b.locator('.ihr-spine').boundingBox();
  for(let i=1;i<=8;i++)await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:p.x+3*i,y:p.y,id:1}]});
  await expect.poll(async()=>{const q=await b.locator('.ihr-spine').boundingBox();samples.push(q);return Math.hypot(q.x-before.x,q.y-before.y)},{timeout:8000}).toBeGreaterThan(3);
  await expect(a.locator('.ihr-spine')).toHaveClass(/is-dragging/);
  const relayed=[...drive.files.values()].filter(f=>f.name?.startsWith('live-v1-')).map(f=>JSON.parse(f.bytes)).filter(m=>m.motion);
  expect(relayed.length).toBeGreaterThan(0);for(const m of relayed){expect(m.motion.data).toMatch(/^[\w+/]+=*$/);expect(JSON.stringify(m.motion)).not.toContain('book:drive:');expect(m.motion.iv).toBeTruthy()}
  await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await touch.detach();await quietShelf(a.locator('.ihr-bookshelf-scene'));await quietShelf(b.locator('.ihr-bookshelf-scene'));
  await expect.poll(async()=>samePoses(await state(a),await state(b)),{timeout:15000}).toBe(true);
  await expect.poll(()=>samePaint(a,b,1),{timeout:15000}).toBeLessThan(.00001);
  expect(await b.evaluate(()=>__originalCanvas===document.querySelector('.ihr-bookshelf-scene')&&__roomDetachments===0)).toBe(true);
  await info.attach('encrypted-relay-held-movement',{body:JSON.stringify({before,samples,mailboxes:relayed.length}),contentType:'application/json'});
 }finally{for(const c of contexts)await c.close()}
});
