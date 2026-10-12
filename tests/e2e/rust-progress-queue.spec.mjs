import {test,expect} from '@playwright/test'
test('compiled mobile reader persists progress and settings through Rust',async({page},info)=>{
 test.setTimeout(60000);await page.setViewportSize({width:390,height:844});await page.emulateMedia({reducedMotion:'reduce'})
 await page.addInitScript(()=>{
  window.progressQueueProof={available:false,calls:{}}
  const observe=result=>{const instance=result.instance||result,actual=instance.exports;if(!actual.rustreadingprogressqueue_new)return result
   window.progressQueueProof.available=true;const exports={...actual}
   for(const name of ['rustreadingprogressqueue_new','rustreadingprogressqueue_patch','rustreadingprogressqueue_updateProgress'])exports[name]=(...args)=>{window.progressQueueProof.calls[name]=(window.progressQueueProof.calls[name]||0)+1;return actual[name](...args)}
   const proxy=new Proxy(instance,{get(target,key){return key==='exports'?exports:Reflect.get(target,key,target)}});return result.instance?{...result,instance:proxy}:proxy
  }
  for(const name of ['instantiate','instantiateStreaming'])if(WebAssembly[name]){const original=WebAssembly[name];WebAssembly[name]=async function(...args){return observe(await Reflect.apply(original,WebAssembly,args))}}
 })
 const errors=[];page.on('pageerror',error=>errors.push(error.message))
 await page.goto(process.env.IHR_TEST_URL||'./');await page.locator('#file-picker').setInputFiles('tests/e2e/fixtures/reading-journey.pdf')
 await expect(page.locator('#reader-location')).toHaveAttribute('aria-label',/Página 1 de 4/)
 await page.locator('#reader-location').click();await page.getByRole('button',{name:'Marcar esta página',exact:true}).click();await expect(page.locator('[data-bookmark]')).toHaveAttribute('aria-pressed','true')
 await page.locator('[data-bookmark]').click();await expect(page.locator('[data-bookmark]')).toHaveAttribute('aria-pressed','false')
 await page.locator('[data-bookmark]').click();await expect(page.locator('[data-bookmark]')).toHaveAttribute('aria-pressed','true')
 await page.getByRole('spinbutton',{name:'Ir a la página'}).fill('4');await page.getByRole('button',{name:'Ir',exact:true}).click()
 await expect(page.locator('#reader-location')).toHaveAttribute('aria-label',/Página 4 de 4/)
 await expect(page.locator('.reader-return')).toContainText('Página 1 de 4');await page.locator('.reader-return').click()
 await expect(page.locator('#reader-location')).toHaveAttribute('aria-label',/Página 1 de 4/)
 await expect.poll(()=>page.evaluate(()=>window.progressQueueProof.calls.rustreadingprogressqueue_updateProgress||0)).toBeGreaterThan(0)
 const proof=await page.evaluate(()=>window.progressQueueProof);expect(proof.available).toBe(true)
 for(const name of ['rustreadingprogressqueue_new','rustreadingprogressqueue_patch','rustreadingprogressqueue_updateProgress'])expect(proof.calls[name]).toBeGreaterThan(0)
 expect(errors).toEqual([]);await info.attach('compiled-progress-queue',{body:JSON.stringify(proof),contentType:'application/json'})
})
