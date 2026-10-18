import {paintedRoomProbe,paintedRoom} from './helpers/painted-room-probe.mjs'
import {test,expect} from '@playwright/test'
import {driveServer} from './helpers/drive-server.mjs'
import {seedShelf,quietShelf,visibleMiddleBookPoint} from './helpers/reader-layout-fixture.mjs'
import {roomProbe} from './helpers/live-room-probe.mjs'
const URL=process.env.IHR_TEST_URL||'/inhouse-read/'
const row=page=>page.evaluate(()=>JSON.parse(localStorage.getItem('inhouse-read-shelf-physics-v1')||'null')?.[2]?.find(r=>r[1]===0))
const lean=page=>page.locator('.ihr-spine').getAttribute('data-scene-lean').then(Number)
test('consecutive live gestures retain exact rendered poses while checkpoints are delayed',async({browser},info)=>{
 test.setTimeout(240000)
 const drive=driveServer(),contexts=[],errors=[];let releaseDrive=()=>{}
 try{
  const make=async viewport=>{const c=await browser.newContext({serviceWorkers:'block',viewport,hasTouch:true,isMobile:viewport.width<500});contexts.push(c);const page=await c.newPage();await roomProbe(page);await paintedRoomProbe(page);page.on('pageerror',e=>errors.push(e.message));await page.emulateMedia({reducedMotion:'reduce'});return page}
  const a=await make({width:390,height:844});await seedShelf(a,{single:true});await drive.connect(contexts[0]);await a.reload();await quietShelf(a.locator('.ihr-bookshelf-scene'))
  await expect.poll(()=>drive.manifests().some(m=>m.books.length===1&&m.settings['inhouse-read-shelf-physics-v1']),{timeout:30000}).toBe(true)
  const b=await make({width:1240,height:900});await drive.connect(contexts[1]);await b.goto(URL);await expect(b.locator('.ihr-spine')).toHaveCount(1);await quietShelf(b.locator('.ihr-bookshelf-scene'))
  await expect.poll(()=>a.evaluate(()=>__roomChannels.some(c=>c.label==='inhouse-read-interactive-v1'&&c.readyState==='open')),{timeout:30000}).toBe(true)
  // Freeze the actual Drive responses and reliable RTC snapshot stream while
  // letting the interactive channel continue delivering the moving book.
  const barrier=new Promise(r=>releaseDrive=r)
  await contexts[1].route(/www\.googleapis\.com\/drive\/v3\//,async route=>{await barrier;await route.fallback()})
  await a.evaluate(()=>{
   globalThis.__queuedRoom=[];globalThis.__resumeRoom=[];globalThis.__droppedRoomEnds=0;
   for(const c of __roomChannels){const send=c.send.bind(c);__resumeRoom.push(()=>{c.send=send});
    if(c.label==='inhouse-read-room-v1')c.send=data=>__queuedRoom.push(()=>send(data));
    else if(c.label==='inhouse-read-interactive-v1')c.send=data=>{
     const packet=JSON.parse(data);if(packet.t==='room-motion'&&packet.phase==='end'&&!__droppedRoomEnds){__droppedRoomEnds++;return}send(data);
    };
   }
  })
  const initial=await row(a),point=await visibleMiddleBookPoint(a),touch=await contexts[0].newCDPSession(a);expect(point).toBeTruthy()
  await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:point.x,y:point.y,id:1}]});await expect(a.locator('.ihr-spine')).toHaveClass(/is-lifted/)
  await expect.poll(async()=>Math.abs(await lean(b)),{timeout:5000}).toBeLessThan(.01)
  const direction=initial[7]<0?-1:1
  for(let i=1;i<=8;i++)await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:point.x+direction*3*i,y:point.y,id:1}]})
  await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await touch.detach();await quietShelf(a.locator('.ihr-bookshelf-scene'))
  let final=await row(a)
  // Start another real gesture before the first reliable checkpoint arrives.
  const point2=await visibleMiddleBookPoint(a),touch2=await contexts[0].newCDPSession(a)
  expect(point2).toBeTruthy()
  await touch2.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:point2.x,y:point2.y,id:1}]})
  await expect(a.locator('.ihr-spine')).toHaveClass(/is-lifted/)
  for(let i=1;i<=10;i++)await touch2.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:point2.x-direction*4*i,y:point2.y,id:1}]})
  await touch2.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await touch2.detach();await quietShelf(a.locator('.ihr-bookshelf-scene'))
  final=await row(a)
  expect(await a.evaluate(()=>__droppedRoomEnds)).toBe(1)
  await expect.poll(async()=>{
    const source=await paintedRoom(a),remote=await paintedRoom(b),key=Object.keys(source).find(k=>k.startsWith('book:'))
    if(!key||!remote[key])return 1
    return Math.max(...source[key].paint.map((v,i)=>Math.abs(v-remote[key].paint[i])))
  },{timeout:5000}).toBeLessThan(.00001)

  await expect.poll(()=>b.evaluate(()=>__roomMotionPackets.some(p=>p.value.phase==='end'&&p.value.commit)),{timeout:15000}).toBe(true)
  await expect.poll(()=>lean(b),{timeout:5000}).toBeCloseTo(final[7],5)
  await b.waitForTimeout(6500)
  expect(await lean(b)).toBeCloseTo(final[7],5)
  // A viewport change must retain the end pose while its durable data is late.
  await b.setViewportSize({width:680,height:790});await quietShelf(b.locator('.ihr-bookshelf-scene'))
  expect(await lean(b)).toBeCloseTo(final[7],5)
  releaseDrive();await a.evaluate(()=>{for(const resume of __resumeRoom)resume();for(const send of __queuedRoom.splice(0))send()})
  await expect.poll(async()=>{const r=await row(b);return r?.[7]},{timeout:30000}).toBeCloseTo(final[7],5)
  await quietShelf(b.locator('.ihr-bookshelf-scene'))
  const received=await row(b)
  for(const i of [5,6,7])expect(received[i]).toBe(final[i])
  await b.reload();await expect(b.locator('.ihr-spine')).toHaveCount(1);await quietShelf(b.locator('.ihr-bookshelf-scene'))
  const reopened=await row(b);for(const i of [5,6,7])expect(reopened[i]).toBe(final[i])
  await expect.poll(()=>b.evaluate(()=>__roomChannels.some(c=>c.label==='inhouse-read-interactive-v1'&&c.readyState==='open')),{timeout:30000}).toBe(true)
  const stale=await a.evaluate(()=>__roomSentMotions.find(p=>p.value.phase==='frame').value)
  await a.evaluate(packet=>{for(const c of __roomChannels)if(c.label==='inhouse-read-interactive-v1'&&c.readyState==='open')c.send(JSON.stringify(packet))},stale)
  await expect.poll(()=>b.evaluate(sequence=>__roomMotionPackets.some(p=>p.value.sequence===sequence),stale.sequence),{timeout:5000}).toBe(true)
  await b.waitForTimeout(300);expect(await lean(b)).toBeCloseTo(final[7],5)
  await info.attach('causal-room',{body:JSON.stringify({initial,final,received,reopened}),contentType:'application/json'})
  expect(errors).toEqual([])
 }finally{releaseDrive();for(const [i,c]of contexts.entries()){for(const p of c.pages())await info.attach(`rendered-${i}`,{body:JSON.stringify(await paintedRoom(p)),contentType:'application/json'});await c.close()}}
})
