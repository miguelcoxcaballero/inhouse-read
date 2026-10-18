import {test,expect} from '@playwright/test';
import {fakeEngineScript} from '../helpers/fake-neural-engine.js';
import {seedShelf,quietShelf} from './helpers/reader-layout-fixture.mjs';
test.use({viewport:{width:390,height:844},hasTouch:true,isMobile:true,deviceScaleFactor:1,serviceWorkers:'block'});
for(const format of ['pdf','epub']) test(`${format}: reading suspends the room GPU and animation work, then returns to the same layout`,async({page},info)=>{
 test.setTimeout(240000);
 await page.addInitScript(fakeEngineScript({installed:['piper:en_US-lessac-high'],hold:true}));
 await page.addInitScript(()=>{
  localStorage.setItem('inhouse-read-neural-used','1');
  localStorage.setItem('inhouse-read-reading-preferences',JSON.stringify({voice:'piper:en_US-lessac-high',voiceLang:'en-US'}));
  const activity={frames:0,draws:0,timers:0,workerMessages:0,workers:[]};window.__readingActivity=activity;
  const raf=requestAnimationFrame;window.requestAnimationFrame=callback=>raf(time=>{activity.frames++;callback(time)});
  for(const kind of ['WebGLRenderingContext','WebGL2RenderingContext']){
   const proto=window[kind]?.prototype;if(!proto)continue;
   for(const name of ['drawArrays','drawElements','drawArraysInstanced','drawElementsInstanced']){
    const original=proto[name];if(original)proto[name]=function(...args){activity.draws++;return original.apply(this,args)};
   }
  }
  for(const kind of ['setTimeout','setInterval']){const original=window[kind];window[kind]=(callback,delay,...args)=>original(typeof callback==='function'?()=>{activity.timers++;callback(...args)}:callback,delay)}
  const Worker=window.Worker;window.Worker=class extends Worker{constructor(url,options){super(url,options);activity.workers.push(String(url))}postMessage(...args){activity.workerMessages++;return super.postMessage(...args)}};
 });
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await seedShelf(page,{mode:'isometric',bookFile:format==='epub'?'reading-journey.epub':'reading-journey.pdf'});
 await page.locator('.ihr-spine').first().focus();await page.keyboard.press('Enter');
 await expect(page.locator('.ihr-flyout__cover-target')).toBeVisible();await page.locator('.ihr-flyout__cover-target').click();
 await expect(page.locator(format==='epub'?'foliate-view':'.pdf-page-canvas')).toBeVisible();await expect(page.locator('#reader-toolbar')).toBeVisible();
 await page.waitForTimeout(3000);
 const snapshot=()=>page.evaluate(()=>({...window.__readingActivity,room:document.querySelector('.ihr-bookshelf-scene')?.dataset.renderCount,pose:localStorage.getItem('inhouse-read-shelf-physics-v1')}));
 const cdp=await page.context().newCDPSession(page);await cdp.send('Performance.enable');
 const cpu=async()=>Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(({name,value})=>[name,value])).TaskDuration;
 const before=await snapshot(),cpuBefore=await cpu();await page.waitForTimeout(8000);const after=await snapshot(),cpuAfter=await cpu();
 const delta={frames:after.frames-before.frames,draws:after.draws-before.draws,timers:after.timers-before.timers,workerMessages:after.workerMessages-before.workerMessages,mainThreadMs:(cpuAfter-cpuBefore)*1000};
 console.log('READER_IDLE',format,JSON.stringify(delta));
 await info.attach('reader-idle',{body:JSON.stringify({delta,before,after}),contentType:'application/json'});
 expect(delta.workerMessages).toBe(0);expect(delta.draws).toBe(0);expect(delta.frames).toBe(0);expect(after.room).toBe(before.room);expect(after.pose).toBe(before.pose);
 // Previously used voices must still stay dormant until audio is requested.
 expect(await page.evaluate(()=>window.__inhouseNeuralTest.engine.warmed)).toEqual([]);
 const oldPage=await page.locator('.reader-location-label').textContent();
 await page.locator('#reader-next').click();
 await expect(page.locator('.reader-location-label')).not.toHaveText(oldPage,{timeout:10000});
 await page.locator('#reader-audio').click();
 await expect.poll(()=>page.evaluate(()=>window.__inhouseNeuralTest.engine.refreshes)).toBeGreaterThan(0);
 await page.locator('[data-play]').click();
 await expect.poll(()=>page.evaluate(()=>window.__inhouseNeuralTest.engine.calls.length)).toBeGreaterThan(0);
 await page.locator('[data-stop]').click();await page.locator('[data-close]').click();
 await page.locator('#reader-back').click();await expect(page.locator('body')).not.toHaveClass(/is-reading|is-closing-reader/);
 await quietShelf(page.locator('.ihr-bookshelf-scene'));expect(errors).toEqual([]);
});
