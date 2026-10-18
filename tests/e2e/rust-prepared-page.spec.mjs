import {test,expect} from '@playwright/test'
import {openCompiledReaderApp} from './helpers/compiled-reader.mjs'
import {waitForFinalBookGeometry} from './helpers/final-book-geometry.mjs'
test.use({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:1})
for(const delayed of [false,true])test('compiled opening consumes the same prepared bitmap through Rust'+(delayed?' after a pending module':''),async({page},info)=>{
 test.setTimeout(90_000);const errors=[];page.on('pageerror',error=>errors.push(error.message));await page.emulateMedia({reducedMotion:'reduce'});
 await page.addInitScript(()=>{
  localStorage.setItem('inhouse-read-shelf-plants','[]');window.preparedProof={available:false,instances:0,calls:{},taken:[]};
  const observe=result=>{
   const instance=result.instance||result,actual=instance.exports;
   if(!actual.rustpreparedpagecache_new&&!actual.app_prepare_book)return result;
   if(actual.rustpreparedpagecache_new){window.preparedProof.available=true;window.preparedProof.instances++;}
   const exports={...actual};
   for(const name of ['rustpreparedpagecache_new','rustpreparedpagecache_begin','rustpreparedpagecache_store','rustpreparedpagecache_take','prepared_page_mismatch','app_prepare_book','app_run_preparation','app_opening_page_snapshot','app_open_book_record','app_reader_ready','app_animate_reader_page','app_open_file_content'])
    if(actual[name])exports[name]=(...args)=>{window.preparedProof.calls[name]=(window.preparedProof.calls[name]||0)+1;return actual[name](...args)};
   const proxy=new Proxy(instance,{get(target,key){return key==='exports'?exports:Reflect.get(target,key,target)}});
   return result.instance?{...result,instance:proxy}:proxy;
  };
  for(const name of ['instantiate','instantiateStreaming'])if(WebAssembly[name]){const original=WebAssembly[name];WebAssembly[name]=async function(...args){return observe(await Reflect.apply(original,WebAssembly,args))}};
 });
 let release;const gate=new Promise(resolve=>{release=resolve}),active=new Set(),pattern=/\/assets\/inhouse_read_ui_bg-[\w-]+\.wasm$/;
 const hold=route=>{const work=(async()=>{await gate;await route.continue()})();active.add(work);work.then(()=>active.delete(work),()=>active.delete(work));return work};if(delayed)await page.route(pattern,hold);
 try{
  const target=process.env.IHR_TEST_URL||'./';if(delayed)await page.goto(target);else await openCompiledReaderApp(page,target);
  await page.evaluate(async()=>{const manifest=await(await fetch(new URL('offline-shell-manifest.json',location.href))).json(),asset=manifest.entries.find(e=>/^assets\/inhouse_read_ui-[\w-]+\.js$/.test(e.path)),ui=await import(new URL(asset.path,location.href));const original=ui.RustPreparedPageCache.prototype.take;ui.RustPreparedPageCache.prototype.take=function(...args){const value=Reflect.apply(original,this,args);if(value)window.preparedProof.taken.push({width:value.width,height:value.height,hasSource:!!value.source});return value}});
  await page.locator('#file-picker').setInputFiles('tests/e2e/fixtures/tiny.pdf');
  // The reader has no JavaScript twin: the import waits for the held module, then everything after it runs on Rust.
  if(delayed){await page.waitForTimeout(2500);expect(await page.evaluate(()=>window.preparedProof.available)).toBe(false);release();await page.waitForFunction(()=>window.preparedProof.available)}
  await expect(page.locator('.pdf-page-canvas')).toBeVisible();await waitForFinalBookGeometry(page,'tiny.pdf');await page.getByRole('button',{name:'Volver a la estantería'}).click();await expect(page.locator('.ihr-flyout')).toHaveCount(0);
  await page.locator('.ihr-spine').first().click();const cover=page.locator('.ihr-flyout__cover-target');await expect(cover).toBeVisible();
  // The same preparation proceeds while the cover waits for the user's tap.
  await page.waitForFunction(()=>document.querySelector('.ihr-flyout')?.classList.contains('is-ready'));
  if(!delayed)await page.waitForFunction(()=>window.preparedProof.calls.rustpreparedpagecache_store>0);
  await cover.click();await expect(page.locator('.pdf-page-canvas')).toBeVisible();await expect(page.locator('.ihr-flyout')).toHaveCount(0);
  await page.waitForFunction(()=>window.preparedProof.taken.length>0);const proof=await page.evaluate(()=>window.preparedProof);expect(proof.instances).toBe(1);expect(proof.calls.rustpreparedpagecache_new).toBe(1);for(const value of proof.taken){expect(value.width).toBeGreaterThan(0);expect(value.height).toBeGreaterThan(0);expect(value.hasSource).toBe(true)}expect(errors).toEqual([]);await info.attach('compiled-prepared-page',{body:JSON.stringify(proof,null,2),contentType:'application/json'});
  for(const name of ['app_prepare_book','app_run_preparation','app_opening_page_snapshot','app_open_book_record','app_reader_ready','app_open_file_content'])expect(proof.calls[name],name+' must run in the real compiled app').toBeGreaterThan(0);
 }finally{release();await Promise.allSettled([...active]);if(delayed&&!page.isClosed())await page.unroute(pattern,hold)}
})
