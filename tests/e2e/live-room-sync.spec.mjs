import {test,expect} from '@playwright/test';
import {driveServer} from './helpers/drive-server.mjs';
import {seedShelf,quietShelf,visibleMiddleBookPoint} from './helpers/reader-layout-fixture.mjs';
const URL=process.env.IHR_TEST_URL||'/inhouse-read/';
const row=page=>page.evaluate(()=>JSON.parse(localStorage.getItem('inhouse-read-shelf-physics-v1')||'null')?.[2]?.find(v=>v[1]===0));
const book=page=>page.evaluate(async()=>{const db=await new Promise(resolve=>{const r=indexedDB.open('inhouse-read');r.onsuccess=()=>resolve(r.result)});const result=await new Promise(resolve=>{const r=db.transaction('books').objectStore('books').getAll();r.onsuccess=()=>resolve(r.result[0])});db.close();return result&&{id:result.id,driveFileId:result.driveFileId,shelfVisualId:result.shelfVisualId,title:result.title,shelfPosition:result.shelfPosition,spineColorOverride:result.spineColorOverride}});

test('mobile and desktop share exact settled book poses and bidirectional edits while open',async({browser},info)=>{
 test.setTimeout(240000);const drive=driveServer(),contexts=[],errors=[];
 try{
  const mobile=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true,deviceScaleFactor:1});contexts.push(mobile);await drive.connect(mobile);
  const a=await mobile.newPage();a.on('pageerror',e=>errors.push(e.message));await a.emulateMedia({reducedMotion:'reduce'});
  await seedShelf(a,{single:true,mode:'isometric'});await quietShelf(a.locator('.ihr-bookshelf-scene'));
  await expect.poll(()=>drive.manifests().some(m=>m.books.length>0&&m.settings['inhouse-read-shelf-physics-v1']),{timeout:30000}).toBe(true);
  const source=await book(a),initial=await row(a);expect(source.driveFileId).toBeTruthy();expect(initial).toBeTruthy();
  const desktop=await browser.newContext({viewport:{width:1000,height:900},hasTouch:true,deviceScaleFactor:1});contexts.push(desktop);await drive.connect(desktop);
  const b=await desktop.newPage();b.on('pageerror',e=>errors.push(e.message));await b.emulateMedia({reducedMotion:'reduce'});await b.goto(URL);
  await expect(b.locator('.ihr-spine')).toHaveCount(1);await quietShelf(b.locator('.ihr-bookshelf-scene'));
  const restored=await book(b);expect(restored.id).not.toBe(source.id);expect(restored.driveFileId).toBe(source.driveFileId);expect(restored.shelfVisualId).toBe(source.id);
  await expect.poll(async()=>Number(await b.locator('.ihr-spine').getAttribute('data-scene-lean'))).toBeCloseTo(initial[7],3);
  const point=await visibleMiddleBookPoint(a,[.5,.7,.3]);expect(point).toBeTruthy();const touch=await mobile.newCDPSession(a);
  await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:point.x,y:point.y,id:1}]});
  await expect(a.locator('.ihr-spine')).toHaveClass(/is-lifted/);await expect.poll(async()=>Math.abs(Number(await a.locator('.ihr-spine').getAttribute('data-scene-lean')))).toBeLessThan(.01);
  const direction=initial[7]<0?-1:1,stamp=await a.evaluate(()=>Date.now()/1000);
  for(let i=1;i<=4;i++)await touch.send('Input.dispatchTouchEvent',{type:'touchMove',timestamp:stamp+i*.016,touchPoints:[{x:point.x+direction*i,y:point.y,id:1}]});
  await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',timestamp:stamp+.08,touchPoints:[]});await touch.detach();
  await quietShelf(a.locator('.ihr-bookshelf-scene'));const moved=await row(a);expect(Math.abs(moved[7]-initial[7])).toBeGreaterThan(.3);
  const published=Date.now();
  await expect.poll(async()=>Number(await b.locator('.ihr-spine').getAttribute('data-scene-lean')),{timeout:15000}).toBeCloseTo(moved[7],3);
  const elapsed=Date.now()-published;await quietShelf(b.locator('.ihr-bookshelf-scene'));const received=await row(b);
  expect(received[7]).toBeCloseTo(moved[7],5);for(const i of [0,1])expect(received[3][i]).toBeCloseTo(moved[3][i],4);
  expect(received[5]-received[2][0]).toBeCloseTo(moved[5]-moved[2][0],4);expect(received[6]-received[2][1]).toBeCloseTo(moved[6]-moved[2][1],4);
  await b.evaluate(async()=>{const db=await new Promise(resolve=>{const r=indexedDB.open('inhouse-read');r.onsuccess=()=>resolve(r.result)});const tx=db.transaction('books','readwrite'),store=tx.objectStore('books'),r=store.getAll();r.onsuccess=()=>store.put({...r.result[0],spineColorOverride:'#224466'});await new Promise(resolve=>tx.oncomplete=resolve);db.close();dispatchEvent(new Event('inhouse-library-changed'))});
  await expect.poll(async()=>(await book(a))?.spineColorOverride,{timeout:15000}).toBe('#224466');await quietShelf(a.locator('.ihr-bookshelf-scene'));
  expect(Number(await a.locator('.ihr-spine').getAttribute('data-scene-lean'))).toBeCloseTo(moved[7],3);
  await info.attach('live-room-sync',{body:JSON.stringify({mobile:source,desktop:restored,initial,moved,received,propagationMs:elapsed}),contentType:'application/json'});
  expect(errors).toEqual([]);
 }finally{for(const context of contexts)await context.close();}
});
