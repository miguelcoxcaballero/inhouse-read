import {test,expect} from '@playwright/test'
import {openCompiledReaderApp} from './helpers/compiled-reader.mjs'
import {waitForFinalBookGeometry} from './helpers/final-book-geometry.mjs'
test.use({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:1})
for(const delayed of [false,true])test('Rust spine batch renders the stored real book length'+(delayed?' after a pending module':''),async({page},info)=>{
 test.setTimeout(90_000);const errors=[];page.on('pageerror',error=>errors.push(error.message));await page.emulateMedia({reducedMotion:'reduce'});
 await page.addInitScript(()=>{
  localStorage.setItem('inhouse-read-shelf-plants','[]');window.spineProof={available:false,calls:0};
  const observe=result=>{const instance=result.instance||result,actual=instance.exports;if(!actual.shelf_spine_styles)return result;window.spineProof.available=true;const exports={...actual,shelf_spine_styles:(...args)=>{window.spineProof.calls++;return actual.shelf_spine_styles(...args)}};const proxy=new Proxy(instance,{get(target,key){return key==='exports'?exports:Reflect.get(target,key,target)}});return result.instance?{...result,instance:proxy}:proxy};for(const name of ['instantiate','instantiateStreaming'])if(WebAssembly[name]){const original=WebAssembly[name];WebAssembly[name]=async function(...args){return observe(await Reflect.apply(original,WebAssembly,args))}};
 });
 let release;const gate=new Promise(resolve=>{release=resolve}),active=new Set(),pattern=/\/assets\/inhouse_read_ui_bg-[\w-]+\.wasm$/;const hold=route=>{const work=(async()=>{await gate;await route.continue()})();active.add(work);work.then(()=>active.delete(work),()=>active.delete(work));return work};if(delayed)await page.route(pattern,hold);
 try{
  if(delayed)await page.goto(process.env.IHR_TEST_URL||'./');else await openCompiledReaderApp(page);
  await page.locator('#file-picker').setInputFiles('tests/e2e/fixtures/tiny.pdf');await expect(page.locator('.pdf-page-canvas')).toBeVisible();await waitForFinalBookGeometry(page,'tiny.pdf');await page.getByRole('button',{name:'Volver a la estantería'}).click();await expect(page.locator('.ihr-flyout')).toHaveCount(0);await expect(page.locator('.ihr-spine').first()).toBeVisible();
  if(delayed){expect(await page.evaluate(()=>window.spineProof.available)).toBe(false);release();await page.waitForFunction(()=>window.spineProof.available)}
  await page.setViewportSize({width:412,height:844});await page.setViewportSize({width:390,height:844});await page.waitForFunction(()=>window.spineProof.calls>0);await expect(page.locator('.ihr-spine').first()).toBeVisible();
  const proof=await page.evaluate(()=>window.spineProof);expect(proof.calls).toBeGreaterThan(0);expect(errors).toEqual([]);await info.attach('compiled-spine-styles',{body:JSON.stringify(proof,null,2),contentType:'application/json'});
 }finally{release();await Promise.allSettled([...active]);if(delayed&&!page.isClosed())await page.unroute(pattern,hold)}
});
