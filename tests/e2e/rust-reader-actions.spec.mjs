import {test,expect} from '@playwright/test'
test('compiled reader uses Rust commands for bookmarks, quotes, search and history',async({page},info)=>{
 test.setTimeout(60000);await page.setViewportSize({width:390,height:844});await page.emulateMedia({reducedMotion:'reduce'})
 await page.addInitScript(()=>{
  window.readerActionsProof={available:false,calls:{}}
  const observe=result=>{const instance=result.instance||result,actual=instance.exports;if(!actual.reader_jump)return result
   window.readerActionsProof.available=true;const exports={...actual}
   for(const name of ['reader_save_places','reader_jump','reader_return','reader_bookmark','reader_quote','reader_search','reader_end_search'])exports[name]=(...args)=>{window.readerActionsProof.calls[name]=(window.readerActionsProof.calls[name]||0)+1;return actual[name](...args)}
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
 await page.getByRole('button',{name:'Buscar en el libro'}).click()
 await page.getByRole('searchbox',{name:'Buscar en el libro'}).fill('Page 3');await page.getByRole('button',{name:'Buscar',exact:true}).click()
 await expect(page.locator('[data-search-status]')).toContainText(/resultado/);await page.locator('[data-search-results] button').first().click()
 await expect(page.locator('#reader-location')).toHaveAttribute('aria-label',/Página 3 de 4/)
 const quote=await page.evaluate(()=>{const span=[...document.querySelectorAll('.pdf-text-layer span')].find(x=>x.textContent?.trim());if(!span)return '';const range=document.createRange();range.selectNodeContents(span);const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);return selection.toString()})
 expect(quote).toBeTruthy();await page.locator('#reader-location').click();await page.getByRole('tab',{name:'Citas'}).click();await page.getByRole('button',{name:'Guardar cita'}).click()
 await expect(page.locator('[data-quotes]')).toContainText(quote.trim())
 const proof=await page.evaluate(()=>window.readerActionsProof);expect(proof.available).toBe(true)
 for(const name of ['reader_save_places','reader_jump','reader_return','reader_bookmark','reader_quote','reader_search','reader_end_search'])expect(proof.calls[name]).toBeGreaterThan(0)
 expect(errors).toEqual([]);await info.attach('compiled-reader-actions',{body:JSON.stringify(proof),contentType:'application/json'})
})
