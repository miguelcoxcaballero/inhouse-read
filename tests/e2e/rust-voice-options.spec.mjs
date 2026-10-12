import {test,expect} from '@playwright/test'
test('compiled mobile reader groups languages and ranks natural voices inside Rust',async({page},info)=>{
 test.setTimeout(60000);await page.setViewportSize({width:390,height:844});await page.emulateMedia({reducedMotion:'reduce'})
 const errors=[];page.on('pageerror',error=>errors.push(error.message))
 await page.addInitScript(()=>{
  window.optionsProof={available:false,calls:{}}
  const observe=result=>{const instance=result.instance||result,actual=instance.exports;if(!actual.language_options)return result
   window.optionsProof.available=true;const exports={...actual}
   for(const name of ['language_options','voice_options'])if(actual[name])exports[name]=(...args)=>{window.optionsProof.calls[name]=(window.optionsProof.calls[name]||0)+1;return actual[name](...args)}
   const proxy=new Proxy(instance,{get(target,key){return key==='exports'?exports:Reflect.get(target,key,target)}});return result.instance?{...result,instance:proxy}:proxy
  }
  for(const name of ['instantiate','instantiateStreaming'])if(WebAssembly[name]){const original=WebAssembly[name];WebAssembly[name]=async function(...args){return observe(await Reflect.apply(original,WebAssembly,args))}}
 })
 await page.goto(process.env.IHR_TEST_URL||'./');await page.locator('#file-picker').setInputFiles('tests/e2e/fixtures/reading-journey.epub')
 await expect(page.locator('foliate-view')).toBeVisible({timeout:45000});await page.getByRole('button',{name:'Escuchar el libro'}).click()
 const language=page.getByRole('button',{name:/^Idioma/}),voice=page.getByRole('button',{name:/^Voz/})
 await language.click();await expect(language).toHaveAttribute('aria-expanded','true')
 await page.keyboard.press('End');await page.keyboard.press('Enter');await expect(language).toHaveAttribute('aria-expanded','false')
 await voice.click();await expect(voice).toHaveAttribute('aria-expanded','true');await page.keyboard.press('Escape');await expect(voice).toBeFocused()
 const proof=await page.evaluate(()=>window.optionsProof);expect(proof.available).toBe(true);expect(proof.calls.language_options).toBeGreaterThan(0);expect(proof.calls.voice_options).toBeGreaterThan(0);expect(errors).toEqual([])
 await info.attach('compiled-rust-voice-options',{body:JSON.stringify(proof),contentType:'application/json'})
})
