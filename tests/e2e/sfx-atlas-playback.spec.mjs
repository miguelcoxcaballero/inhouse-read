import {test,expect} from '@playwright/test';
import {seedShelf,quietShelf,visibleMiddleBookPoint} from './helpers/reader-layout-fixture.mjs';
test.use({viewport:{width:390,height:844},hasTouch:true,isMobile:true,deviceScaleFactor:1});
test('the published atlas plays recorded lamp and book events and parks audio afterwards',async({page},info)=>{
 test.setTimeout(240_000);
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.addInitScript(()=>{
  window.recordedAudio={events:[],contexts:[],kinds:[]};
  const observe=result=>{const instance=result.instance||result,actual=instance.exports;if(!actual.cozy_clip)return result;
   const exports={...actual,cozy_clip:(...args)=>{window.recordedAudio.kinds.push(args.slice(-3)[0]);return actual.cozy_clip(...args)}};
   const proxy=new Proxy(instance,{get(target,key){return key==='exports'?exports:Reflect.get(target,key,target)}});return result.instance?{...result,instance:proxy}:proxy};
  for(const name of ['instantiate','instantiateStreaming'])if(WebAssembly[name]){const original=WebAssembly[name];WebAssembly[name]=async function(...args){return observe(await Reflect.apply(original,WebAssembly,args))}};
  class Node{gain={value:0,setTargetAtTime(){}};pan={value:0};connect(){}disconnect(){}}
  class Context{
   state='running';currentTime=0;destination={};constructor(){window.recordedAudio.contexts.push(this)}
   createGain(){return new Node()}createStereoPanner(){return new Node()}
   createBuffer(_,length,rate){return{length,sampleRate:rate,pcm:null,copyToChannel(pcm){this.pcm=Float32Array.from(pcm)}}}
   createBufferSource(){const s=new Node();let timer;s.playbackRate={value:1};
    s.start=()=>{if(s.buffer.length>1)window.recordedAudio.events.push({rate:s.buffer.sampleRate,length:s.buffer.length,peak:Math.max(...s.buffer.pcm.map(Math.abs))});timer=setTimeout(()=>s.onended?.(),s.buffer.length/s.buffer.sampleRate*1000)};
    s.stop=()=>{clearTimeout(timer);setTimeout(()=>s.onended?.(),0)};return s}
   async suspend(){this.state='suspended'}async resume(){this.state='running'}async close(){this.state='closed'}
  }window.AudioContext=Context;
 });
 const scene=await seedShelf(page,{mode:'spine'});expect(await page.evaluate(()=>window.recordedAudio.contexts.length)).toBe(0);
 const binary=page.waitForResponse(r=>/\/assets\/atlas-[\w-]+\.bin$/.test(r.url())&&r.ok());
 const lamp=page.locator('.ihr-lamp[data-lamp-id="tarnaby"]');await lamp.tap();await binary;await quietShelf(scene);
 await lamp.tap();await expect.poll(()=>page.evaluate(()=>window.recordedAudio.events.filter(e=>e.rate===48000).length)).toBeGreaterThan(0);
 for(const selector of ['.ihr-plant','.ihr-lamp']){
  const node=page.locator(selector).first(),box=await node.boundingBox();expect(box).not.toBeNull();
  const x=box.x+box.width/2,y=box.y+box.height*.88;
  await page.mouse.move(x,y);await page.mouse.down();await page.waitForTimeout(440);await expect(node).toHaveClass(/is-lifted/);
  await page.waitForTimeout(300);await page.mouse.move(x+24,y-4,{steps:5});await page.mouse.up();await quietShelf(page.locator('.ihr-bookshelf-scene'));
 }
 await info.attach('sound-event-kinds',{body:JSON.stringify(await page.evaluate(()=>window.recordedAudio.kinds)),contentType:'application/json'});
 await expect.poll(()=>page.evaluate(()=>window.recordedAudio.kinds.includes(14)&&window.recordedAudio.kinds.some(k=>k===12||k===13)),{timeout:5000}).toBe(true);
 await expect.poll(()=>page.evaluate(()=>window.recordedAudio.kinds.includes(22)&&window.recordedAudio.kinds.some(k=>k===9||k===10)),{timeout:5000}).toBe(true);
 expect(await page.evaluate(()=>window.recordedAudio.kinds.some(k=>[4,8,11,18].includes(k)))).toBe(false);
 const point=await visibleMiddleBookPoint(page);expect(point).not.toBeNull();await page.touchscreen.tap(point.x,point.y);
 await expect(page.locator('.ihr-flyout.is-ready')).toBeVisible();await page.locator('.ihr-flyout__cover-target').click();
 await expect(page.locator('#reader-toolbar')).toBeVisible();
 await expect.poll(()=>page.evaluate(()=>window.recordedAudio.events.filter(e=>e.rate===48000).length)).toBeGreaterThanOrEqual(3);
 await page.getByRole('button',{name:'Volver a la estantería'}).click();await expect(page.locator('.ihr-flyout')).toHaveCount(0);await quietShelf(page.locator('.ihr-bookshelf-scene'));
 await expect.poll(()=>page.evaluate(()=>window.recordedAudio.contexts.every(c=>c.state==='suspended'||c.state==='closed'))).toBe(true);
 const events=await page.evaluate(()=>window.recordedAudio.events);expect(events.filter(e=>e.rate===48000).every(e=>e.peak>0&&e.peak<1)).toBe(true);
 await info.attach('recorded-atlas-playback',{body:JSON.stringify(events),contentType:'application/json'});
});
