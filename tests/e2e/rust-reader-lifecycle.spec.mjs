import {test,expect} from '@playwright/test'
test('compiled reader opens, refreshes names and closes through Rust while keeping saved reading places',async({page},info)=>{
 test.setTimeout(90000);await page.setViewportSize({width:390,height:844});await page.emulateMedia({reducedMotion:'reduce'})
 await page.addInitScript(()=>{
  window.lifecycleProof={available:false,calls:{}}
  const observe=result=>{const instance=result.instance||result,actual=instance.exports;if(!actual.reader_open)return result
   window.lifecycleProof.available=true;const exports={...actual}
   for(const name of ['reader_open','reader_refresh_names','reader_close_voice','reader_reset','reader_show'])exports[name]=(...args)=>{window.lifecycleProof.calls[name]=(window.lifecycleProof.calls[name]||0)+1;return actual[name](...args)}
   const proxy=new Proxy(instance,{get(target,key){return key==='exports'?exports:Reflect.get(target,key,target)}});return result.instance?{...result,instance:proxy}:proxy
  }
  for(const name of ['instantiate','instantiateStreaming'])if(WebAssembly[name]){const original=WebAssembly[name];WebAssembly[name]=async function(...args){return observe(await Reflect.apply(original,WebAssembly,args))}}
 })
 const errors=[];page.on('pageerror',error=>errors.push(error.message))
 await page.goto(process.env.IHR_TEST_URL||'./');await page.locator('#file-picker').setInputFiles('tests/e2e/fixtures/reading-journey.pdf')
 await expect(page.locator('#reader-location')).toHaveAttribute('aria-label',/Página 1 de 4/)
 await page.getByRole('button',{name:'Página siguiente',exact:true}).click()
 await expect(page.locator('#reader-location')).toHaveAttribute('aria-label',/Página 2 de 4/)
 await page.locator('#reader-location').click();await page.getByRole('button',{name:'Marcar esta página',exact:true}).click()
 await expect(page.locator('[data-bookmarks]')).toContainText('Página 2 de 4')
 await page.getByRole('spinbutton',{name:'Ir a la página'}).fill('4');await page.getByRole('button',{name:'Ir',exact:true}).click()
 await expect(page.locator('#reader-location')).toHaveAttribute('aria-label',/Página 4 de 4/)
 await page.getByRole('button',{name:'Volver a la estantería'}).click()
 await page.locator('.ihr-spine').first().click();await page.getByRole('button',{name:'Editar',exact:true}).click()
 await page.getByLabel('Texto del lomo',{exact:true}).fill('Título migrado');await page.getByRole('button',{name:'Listo',exact:true}).click()
 await page.locator('.ihr-flyout__cover-target').click();await expect(page.locator('.ihr-flyout')).toHaveCount(0)
 await expect(page.locator('#reader-top-title')).toHaveText('Título migrado')
 await expect(page.locator('#reader-location')).toHaveAttribute('aria-label',/Página 4 de 4/)
 await page.locator('.reader-return').click();await expect(page.locator('#reader-location')).toHaveAttribute('aria-label',/Página 2 de 4/)
 await page.locator('#reader-location').click();await expect(page.locator('[data-bookmarks]')).toContainText('Página 2 de 4')
 const proof=await page.evaluate(()=>window.lifecycleProof);expect(proof.available).toBe(true)
 for(const name of ['reader_open','reader_refresh_names','reader_close_voice','reader_reset','reader_show'])expect(proof.calls[name]).toBeGreaterThan(0)
 expect(errors).toEqual([]);await info.attach('compiled-reader-lifecycle',{body:JSON.stringify(proof),contentType:'application/json'})
})
