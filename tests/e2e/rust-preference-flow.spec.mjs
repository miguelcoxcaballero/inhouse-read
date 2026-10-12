import {test,expect} from '@playwright/test'
test('compiled reader applies appearance and audio preferences through Rust without moving the page',async({page},info)=>{
 test.setTimeout(60000);await page.setViewportSize({width:390,height:844});await page.emulateMedia({reducedMotion:'reduce'})
 await page.addInitScript(()=>{
  window.preferenceFlowProof={available:false,calls:{}}
  const observe=result=>{const instance=result.instance||result,actual=instance.exports;if(!actual.reader_set_preference)return result
   window.preferenceFlowProof.available=true;const exports={...actual}
   for(const name of ['reader_set_preference','reader_apply_preferences'])exports[name]=(...args)=>{window.preferenceFlowProof.calls[name]=(window.preferenceFlowProof.calls[name]||0)+1;return actual[name](...args)}
   const proxy=new Proxy(instance,{get(target,key){return key==='exports'?exports:Reflect.get(target,key,target)}});return result.instance?{...result,instance:proxy}:proxy
  }
  for(const name of ['instantiate','instantiateStreaming'])if(WebAssembly[name]){const original=WebAssembly[name];WebAssembly[name]=async function(...args){return observe(await Reflect.apply(original,WebAssembly,args))}}
 })
 const errors=[];page.on('pageerror',error=>errors.push(error.message))
 await page.goto(process.env.IHR_TEST_URL||'./');await page.locator('#file-picker').setInputFiles('tests/e2e/fixtures/reading-journey.pdf')
 await expect(page.locator('#reader-location')).toHaveAttribute('aria-label',/Página 1 de 4/)
 await page.getByRole('button',{name:'Aspecto de lectura'}).click();await page.getByRole('button',{name:'AMOLED',exact:true}).click()
 await expect(page.locator('#reader-screen')).toHaveAttribute('data-reading-theme','amoled')
 await page.getByRole('button',{name:'Cerrar opciones de lectura'}).click();await page.getByRole('button',{name:'Escuchar el libro'}).click()
 await page.locator('[data-rate][value="2"]').check();await expect(page.locator('[data-rate][value="2"]')).toBeChecked()
 await expect(page.locator('#reader-location')).toHaveAttribute('aria-label',/Página 1 de 4/)
 const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('inhouse-read-reading-preferences')))
 expect(saved).toMatchObject({theme:'amoled',rate:2})
 const proof=await page.evaluate(()=>window.preferenceFlowProof);expect(proof.available).toBe(true)
 for(const name of ['reader_set_preference','reader_apply_preferences'])expect(proof.calls[name]).toBeGreaterThan(0)
 expect(errors).toEqual([]);await info.attach('compiled-preference-flow',{body:JSON.stringify(proof),contentType:'application/json'})
})
