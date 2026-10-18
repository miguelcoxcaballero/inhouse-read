import {test,expect} from '@playwright/test'
import {driveServer} from './helpers/drive-server.mjs'
import {seedShelf,quietShelf} from './helpers/reader-layout-fixture.mjs'
import {roomProbe} from './helpers/live-room-probe.mjs'
const URL=process.env.IHR_TEST_URL||'/inhouse-read/'
for(const blocked of [false,true])test(`lamp switches stay live through ${blocked?'blocked RTC':'channel failure and resume'}`,async({browser},info)=>{
 test.setTimeout(180000)
 let delayBackups=false
 const drive=driveServer({privateAppProperties:true,beforeUpload:async meta=>{if(delayBackups&&meta.name?.startsWith('library-v1-'))await new Promise(r=>setTimeout(r,10000))}}),contexts=[],errors=[]
 try{
  const make=async()=>{
   const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true});contexts.push(context)
   if(blocked)await context.addInitScript(()=>{globalThis.RTCPeerConnection=class{constructor(){throw Error('RTC unavailable')}}})
   const page=await context.newPage();if(!blocked)await roomProbe(page);page.on('pageerror',e=>errors.push(e.message));await page.emulateMedia({reducedMotion:'reduce'});return page
  }
  const a=await make();await seedShelf(a,{single:true,withLamp:true,mode:'frontal'});await drive.connect(contexts[0]);await a.reload();await quietShelf(a.locator('.ihr-bookshelf-scene'))
  await expect.poll(()=>drive.manifests().some(m=>m.books.length===1&&m.settings['inhouse-read-shelf-lamps']),{timeout:30000}).toBe(true)
  const b=await make();await drive.connect(contexts[1]);await b.goto(URL);await expect(b.locator('.ihr-lamp')).toHaveCount(1);await quietShelf(b.locator('.ihr-bookshelf-scene'))
  if(!blocked)await expect.poll(()=>b.evaluate(()=>__roomChannels.some(c=>c.label==='inhouse-read-interactive-v1'&&c.readyState==='open')),{timeout:30000}).toBe(true)
  delayBackups=true
  const switches=[]
  async function toggle(source,target,wanted){
   const start=Date.now();await source.locator('.ihr-lamp').press('Enter');await expect(source.locator('.ihr-lamp')).toHaveAttribute('data-lamp-on',String(wanted))
   await expect(target.locator('.ihr-lamp')).toHaveAttribute('data-lamp-on',String(wanted),{timeout:blocked?8000:5000});switches.push(Date.now()-start)
  }
  await toggle(a,b,false);await toggle(b,a,true)
  if(!blocked){
   // A real peer closes, then a fresh channel must establish without reloading.
   await b.evaluate(()=>{for(const pc of __roomPeers)pc.close()})
   await expect.poll(()=>b.evaluate(()=>__roomPeers.filter(p=>p.connectionState==='connected').length),{timeout:30000}).toBeGreaterThan(0)
   await toggle(a,b,false)
   // Exercise the app's real visibility handlers and a retained-state restart.
   await b.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'hidden'});document.dispatchEvent(new Event('visibilitychange'))})
   await a.locator('.ihr-lamp').press('Enter');await expect(a.locator('.ihr-lamp')).toHaveAttribute('data-lamp-on','true')
   await b.evaluate(()=>{delete document.hidden;delete document.visibilityState;document.dispatchEvent(new Event('visibilitychange'))})
   await expect(b.locator('.ihr-lamp')).toHaveAttribute('data-lamp-on','true',{timeout:15000})
   await toggle(b,a,false)
  }else{
   const states=[...drive.files.values()].filter(f=>f.name?.startsWith('live-state-v1-'))
   expect(states.length).toBeGreaterThan(0)
   for(const file of states){const envelope=JSON.parse(file.bytes);expect(envelope.data).toBeTruthy();expect(envelope.iv).toBeTruthy();expect(file.bytes.toString()).not.toContain('isOn')}
   await toggle(a,b,false)
  }
  await info.attach('switch-latencies',{body:JSON.stringify({blocked,switches}),contentType:'application/json'})
  expect(errors).toEqual([])
 }finally{for(const context of contexts)await context.close()}
})
