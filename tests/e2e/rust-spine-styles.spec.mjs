import {test,expect} from '@playwright/test'
import {openCompiledReaderApp} from './helpers/compiled-reader.mjs'
import {waitForFinalBookGeometry} from './helpers/final-book-geometry.mjs'
test.use({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:1})
// The spine styles and the packing of the shelf are the app core's
// (rust-core/src/shelf_layout.rs), compiled by the page while the app loads.
// They no longer wait for the UI module: with that module still pending, a
// stored book is drawn, with its real length, from compiled code.
for(const delayed of [false,true])test('Rust spine batch renders the stored real book length'+(delayed?' while the UI module is pending':''),async({page},info)=>{
 test.setTimeout(90_000);const errors=[];page.on('pageerror',error=>errors.push(error.message));await page.emulateMedia({reducedMotion:'reduce'});
 await page.addInitScript(()=>{
  localStorage.setItem('inhouse-read-shelf-plants','[]');window.spineProof={available:false,calls:0,layouts:0};
  const observe=result=>{const instance=result.instance||result,actual=instance.exports;if(!actual.spine_styles)return result;window.spineProof.available=true;const exports={...actual,spine_styles:(...args)=>{window.spineProof.calls++;return actual.spine_styles(...args)},layout_shelves:(...args)=>{window.spineProof.layouts++;return actual.layout_shelves(...args)}};const proxy=new Proxy(instance,{get(target,key){return key==='exports'?exports:Reflect.get(target,key,target)}});return result.instance?{...result,instance:proxy}:proxy};for(const name of ['instantiate','instantiateStreaming'])if(WebAssembly[name]){const original=WebAssembly[name];WebAssembly[name]=async function(...args){return observe(await Reflect.apply(original,WebAssembly,args))}};
 });
 let release;const gate=new Promise(resolve=>{release=resolve}),active=new Set(),pattern=/\/assets\/inhouse_read_ui_bg-[\w-]+\.wasm$/;const hold=route=>{const work=(async()=>{await gate;await route.continue()})();active.add(work);work.then(()=>active.delete(work),()=>active.delete(work));return work};
 try{
  await openCompiledReaderApp(page);
  await page.locator('#file-picker').setInputFiles('tests/e2e/fixtures/tiny.pdf');await expect(page.locator('.pdf-page-canvas')).toBeVisible();await waitForFinalBookGeometry(page,'tiny.pdf');await page.getByRole('button',{name:'Volver a la estantería'}).click();await expect(page.locator('.ihr-flyout')).toHaveCount(0);await expect(page.locator('.ihr-spine').first()).toBeVisible();
  if(delayed){
   // A new launch with the stored book, the UI module held back.
   await page.route(pattern,hold);await page.reload();
   await expect(page.locator('.ihr-spine').first()).toBeVisible();
   expect(await page.evaluate(()=>window.spineProof.available)).toBe(true);
   await page.waitForFunction(()=>window.spineProof.calls>0&&window.spineProof.layouts>0);
   release();
  }
  const before=await page.evaluate(()=>window.spineProof.calls);
  await page.setViewportSize({width:412,height:844});await page.setViewportSize({width:390,height:844});await page.waitForFunction(count=>window.spineProof.calls>count,before);await expect(page.locator('.ihr-spine').first()).toBeVisible();
  const proof=await page.evaluate(()=>window.spineProof);expect(proof.available).toBe(true);expect(proof.calls).toBeGreaterThan(0);expect(proof.layouts).toBeGreaterThan(0);expect(errors).toEqual([]);await info.attach('compiled-spine-styles',{body:JSON.stringify(proof,null,2),contentType:'application/json'});
 }finally{release();await Promise.allSettled([...active]);if(delayed&&!page.isClosed())await page.unroute(pattern,hold)}
});
