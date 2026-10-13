import {test,expect} from '@playwright/test'
import {openCompiledReaderApp} from './helpers/compiled-reader.mjs'
import {waitForFinalBookGeometry} from './helpers/final-book-geometry.mjs'
test.use({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:1})
for(const delayed of [false,true])test('compiled selection preserves the current gate and uses Rust for later opening'+(delayed?' after a pending module':''),async({page},info)=>{
 test.setTimeout(90_000);const errors=[];page.on('pageerror',error=>errors.push(error.message));await page.emulateMedia({reducedMotion:'reduce'});
 await page.addInitScript(()=>{
  localStorage.setItem('inhouse-read-shelf-plants','[]');window.stageProof={available:false,instances:0,calls:{}};
  const observe=result=>{const instance=result.instance||result,actual=instance.exports;if(!actual.ruststagegate_new)return result;window.stageProof.available=true;window.stageProof.instances++;const exports={...actual};for(const name of ['ruststagegate_new','ruststagegate_wait','ruststagegate_release'])exports[name]=(...args)=>{window.stageProof.calls[name]=(window.stageProof.calls[name]||0)+1;return actual[name](...args)};const proxy=new Proxy(instance,{get(target,key){return key==='exports'?exports:Reflect.get(target,key,target)}});return result.instance?{...result,instance:proxy}:proxy};for(const name of ['instantiate','instantiateStreaming'])if(WebAssembly[name]){const original=WebAssembly[name];WebAssembly[name]=async function(...args){return observe(await Reflect.apply(original,WebAssembly,args))}};
 });
 let release;const gate=new Promise(resolve=>{release=resolve}),active=new Set(),pattern=/\/assets\/inhouse_read_ui_bg-[\w-]+\.wasm$/;
 const hold=route=>{const work=(async()=>{await gate;await route.continue()})();active.add(work);work.then(()=>active.delete(work),()=>active.delete(work));return work};if(delayed)await page.route(pattern,hold);
 try{
  const target=process.env.IHR_TEST_URL||'./';if(delayed)await page.goto(target);else await openCompiledReaderApp(page,target);
  await page.locator('#file-picker').setInputFiles('tests/e2e/fixtures/tiny.pdf');await expect(page.locator('.pdf-page-canvas')).toBeVisible();await waitForFinalBookGeometry(page,'tiny.pdf');await page.getByRole('button',{name:'Volver a la estantería'}).click();await expect(page.locator('.ihr-flyout')).toHaveCount(0);
  const open=async()=>{await page.locator('.ihr-spine').first().click();await expect(page.locator('.ihr-flyout')).toHaveClass(/is-ready/);await page.locator('.ihr-flyout__cover-target').click();await expect(page.locator('.pdf-page-canvas')).toBeVisible();await expect(page.locator('.ihr-flyout')).toHaveCount(0)};
  await page.locator('.ihr-spine').first().click();await expect(page.locator('.ihr-flyout')).toHaveClass(/is-ready/);
  if(delayed){expect(await page.evaluate(()=>window.stageProof.available)).toBe(false);release();await page.waitForFunction(()=>window.stageProof.available)}
  await page.locator('.ihr-flyout__cover-target').click();await expect(page.locator('.pdf-page-canvas')).toBeVisible();await expect(page.locator('.ihr-flyout')).toHaveCount(0);await page.getByRole('button',{name:'Volver a la estantería'}).click();await expect(page.locator('.ihr-flyout')).toHaveCount(0);
  await open();await page.waitForFunction(()=>window.stageProof.calls.ruststagegate_wait>0&&window.stageProof.calls.ruststagegate_release>0);
  await page.getByRole('button',{name:'Volver a la estantería'}).click();await expect(page.locator('.ihr-flyout')).toHaveCount(0);await page.locator('.ihr-spine').first().click();await expect(page.locator('.ihr-flyout')).toHaveClass(/is-ready/);const beforeCancel=await page.evaluate(()=>window.stageProof.calls.ruststagegate_release||0);await page.locator('.ihr-flyout__close').click();await expect(page.locator('.ihr-flyout')).toHaveCount(0);await expect(page.locator('#reader-screen')).toBeHidden();await expect.poll(()=>page.evaluate(()=>window.stageProof.calls.ruststagegate_release||0)).toBeGreaterThan(beforeCancel);
  const proof=await page.evaluate(()=>window.stageProof);expect(proof.instances).toBe(1);expect(proof.calls.ruststagegate_new).toBeGreaterThan(0);expect(errors).toEqual([]);await info.attach('compiled-stage-gate',{body:JSON.stringify(proof,null,2),contentType:'application/json'});
 }finally{release();await Promise.allSettled([...active]);if(delayed&&!page.isClosed())await page.unroute(pattern,hold)}
})
