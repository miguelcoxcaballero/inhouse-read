import {test,expect} from '@playwright/test'
import {installEmptyUpdateChannels} from './helpers/empty-update-channels.mjs'
import {openCompiledReaderApp} from './helpers/compiled-reader.mjs'
installEmptyUpdateChannels()
test.use({viewport:{width:390,height:844},isMobile:true,hasTouch:true})
for(const delayed of [false,true])test('Rust account menu preserves updater focus and live DOM'+(delayed?' after a pending module':''),async({page},info)=>{
 const url=process.env.IHR_TEST_URL?new URL(process.env.IHR_TEST_URL):null;if(url)url.searchParams.set('inhouse_app','1');const target=url?.href||'./?inhouse_app=1';
 test.setTimeout(60_000);const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(()=>{
  window.profileProof={available:false,calls:{}};
  const observe=result=>{const instance=result.instance||result,actual=instance.exports;if(!actual.rustprofileview_new)return result;window.profileProof.available=true;const exports={...actual};for(const name of ['rustprofileview_new','rustprofileview_connect','rustprofileview_profile','rustprofileview_closeMenu','rustprofileview_syncStatus'])exports[name]=(...args)=>{window.profileProof.calls[name]=(window.profileProof.calls[name]||0)+1;return actual[name](...args)};const proxy=new Proxy(instance,{get(target,key){return key==='exports'?exports:Reflect.get(target,key,target)}});return result.instance?{...result,instance:proxy}:proxy};
  for(const name of ['instantiate','instantiateStreaming'])if(WebAssembly[name]){const original=WebAssembly[name];WebAssembly[name]=async function(...args){return observe(await Reflect.apply(original,WebAssembly,args))}};
 });
 let release;const gate=new Promise(resolve=>{release=resolve}),active=new Set(),pattern=/\/assets\/inhouse_read_ui_bg-[\w-]+\.wasm$/;
 const hold=route=>{const work=(async()=>{await gate;await route.continue()})();active.add(work);work.then(()=>active.delete(work),()=>active.delete(work));return work};
 if(delayed)await page.route(pattern,hold);
 try{
  if(delayed)await page.goto(target);else await openCompiledReaderApp(page,target);
  const menu=page.locator('#drive-profile-menu'),profile=page.locator('#drive-profile-btn'),entry=page.getByRole('button',{name:'Actualizaciones',exact:true});
  await expect(profile).toBeVisible();await profile.click();await expect(menu).toBeVisible();await expect(page.locator('#drive-theme-toggle')).toBeFocused();
  await page.evaluate(()=>{window.profileOriginal=document.querySelector('#drive-profile');window.profileMenuOriginal=document.querySelector('#drive-profile-menu')});
  if(delayed){expect(await page.evaluate(()=>window.profileProof.available)).toBe(false);release()}
  await page.waitForFunction(()=>window.profileProof.calls.rustprofileview_connect>0);
  expect(await page.evaluate(()=>window.profileOriginal===document.querySelector('#drive-profile')&&window.profileMenuOriginal===document.querySelector('#drive-profile-menu'))).toBe(true);await expect(menu).toBeVisible();
  await entry.click();const panel=page.locator('#drive-update-settings');await expect(panel.locator('.isu-inline')).toBeVisible();await page.getByRole('button',{name:'Check for updates',exact:true}).click();await expect(panel).toContainText('No releases on version B.');await expect(menu).toBeVisible();
  await page.keyboard.press('Escape');await expect(panel).toBeHidden();await expect(menu).toBeVisible();await expect(entry).toBeFocused();await page.keyboard.press('Escape');await expect(menu).toBeHidden();await expect(profile).toBeFocused();
  await profile.click();await expect(menu).toBeVisible();await page.locator('.app-header .logo').click();await expect(menu).toBeHidden();const proof=await page.evaluate(()=>window.profileProof);expect(proof.calls.rustprofileview_new).toBe(1);expect(proof.calls.rustprofileview_connect).toBe(1);expect(errors).toEqual([]);await info.attach('compiled-profile-kernels',{body:JSON.stringify(proof,null,2),contentType:'application/json'});
 }finally{release();await Promise.allSettled([...active]);if(delayed&&!page.isClosed())await page.unroute(pattern,hold)}
});
