import {test,expect} from '@playwright/test';
import {openCompiledReaderApp} from './helpers/compiled-reader.mjs';
import {waitForFinalBookGeometry} from './helpers/final-book-geometry.mjs';
test.use({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:1});
test('the compiled app closes through Rust once for a double press and preserves the saved page',async({page},info)=>{
 test.setTimeout(120_000);const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.addInitScript(()=>{
  localStorage.setItem('inhouse-read-shelf-plants','[]');window.closeProof={calls:{},modules:[],handoffs:0};
  const add=DOMTokenList.prototype.add;
  DOMTokenList.prototype.add=function(...names){const starts=this===document.body?.classList&&names.includes('is-reader-page-leaving')&&!this.contains('is-reader-page-leaving');const result=Reflect.apply(add,this,names);if(starts)window.closeProof.handoffs++;return result};
  const observe=result=>{
   const instance=result.instance||result,actual=instance.exports;
   if(!actual.app_close_reader)return result;
   window.closeProof.modules.push(actual.rustbookshelfcontroller_new?'shelf':'ui');const exports={...actual};
   for(const name of ['app_close_reader','app_return_page_handoff','app_remove_return_page'])if(actual[name])exports[name]=(...args)=>{window.closeProof.calls[name]=(window.closeProof.calls[name]||0)+1;return actual[name](...args)};
   const proxy=new Proxy(instance,{get(target,key){return key==='exports'?exports:Reflect.get(target,key,target)}});
   return result.instance?{...result,instance:proxy}:proxy;
  };
  for(const name of ['instantiate','instantiateStreaming'])if(WebAssembly[name]){const original=WebAssembly[name];WebAssembly[name]=async function(...args){return observe(await Reflect.apply(original,WebAssembly,args))}};
 });
 await openCompiledReaderApp(page);
 await page.locator('#file-picker').setInputFiles('tests/e2e/fixtures/reading-journey.pdf');
 await expect(page.locator('.pdf-page-canvas')).toBeVisible();await waitForFinalBookGeometry(page,'reading-journey.pdf');
 await page.locator('#reader-next').click();await expect(page.locator('#reader-location')).toHaveAttribute('aria-label',/Página 2 de/);
 await page.evaluate(()=>{document.getElementById('reader-back').click();document.getElementById('reader-back').click()});
 await expect(page.locator('body')).not.toHaveClass(/is-reading|is-closing-reader/);await expect(page.locator('.ihr-flyout')).toHaveCount(0);
 expect(await page.evaluate(()=>window.closeProof.calls.app_close_reader)).toBe(2);
 await page.locator('.ihr-spine').first().click();const cover=page.locator('.ihr-flyout__cover-target');await expect(cover).toBeVisible();await cover.click();
 await expect(page.locator('#reader-location')).toHaveAttribute('aria-label',/Página 2 de/);
 await page.locator('#reader-back').click();await expect(page.locator('body')).not.toHaveClass(/is-reading|is-closing-reader/);await expect(page.locator('.ihr-flyout')).toHaveCount(0);
 const proof=await page.evaluate(()=>({...window.closeProof,leaks:document.querySelectorAll('.ihr-reader-return-page,.ihr-flyout--return').length}));
 expect(proof.calls.app_close_reader).toBe(3);expect(proof.calls.app_return_page_handoff).toBeGreaterThanOrEqual(2);expect(proof.handoffs).toBe(2);expect(proof.leaks).toBe(0);expect(errors).toEqual([]);
 await info.attach('compiled-native-reader-close',{body:JSON.stringify(proof),contentType:'application/json'});
});
