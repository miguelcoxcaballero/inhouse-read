import {test,expect} from '@playwright/test'
import {createServer} from 'node:http'
import {readFile} from 'node:fs/promises'
let server,url
test.beforeAll(async()=>{
 const paths={'/':'tests/e2e/fixtures/rust-select-menu.html','/ui.js':'src/wasm/ui/inhouse_read_ui.js','/inhouse_read_ui_bg.wasm':'src/wasm/ui/inhouse_read_ui_bg.wasm','/reference.js':'src/js/readers/select-menu-legacy.js'}
 server=createServer(async(req,res)=>{try{const file=paths[req.url];if(!file){res.writeHead(404);return res.end()}
  res.setHeader('Content-Type',file.endsWith('.wasm')?'application/wasm':file.endsWith('.html')?'text/html; charset=utf-8':'text/javascript; charset=utf-8');res.end(await readFile(file))
 }catch(error){res.writeHead(500);res.end(String(error))}})
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));url=`http://127.0.0.1:${server.address().port}/`
})
test.afterAll(async()=>{server?.closeAllConnections();if(server)await new Promise(resolve=>server.close(resolve))})
test('Rust menus retain exact DOM, ARIA, focus, event order and bounded disposal memory',async({browser},info)=>{
 const results=[]
 for(const rust of [false,true]){
  const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];page.on('pageerror',error=>errors.push(error.message))
  try{await page.goto(url);await page.waitForFunction(()=>window.run)
   results.push(await page.evaluate(rust=>window.run(rust),rust))
   if(rust){const memory=await page.evaluate(()=>window.memory());expect(memory.after).toBe(memory.before);await info.attach('rust-menu-memory',{body:JSON.stringify(memory),contentType:'application/json'})}
   expect(errors).toEqual([])
  }finally{await page.close()}
 }
 expect(results[1]).toEqual(results[0]);await info.attach('rust-menu-parity',{body:JSON.stringify(results),contentType:'application/json'})
})
test('compiled mobile reader runs its actual language and voice menus inside Rust',async({page},info)=>{
 test.setTimeout(60000);await page.setViewportSize({width:390,height:844});await page.emulateMedia({reducedMotion:'reduce'})
 const errors=[];page.on('pageerror',error=>errors.push(error.message))
 await page.addInitScript(()=>{
  window.menuProof={available:false,calls:{}}
  const observe=result=>{const instance=result.instance||result,actual=instance.exports;if(!actual.ui_abi_version)return result
   window.menuProof.available=true;const exports={...actual}
   for(const name of ['rustselectmenu_new','rustselectmenu_setOptions','rustselectmenu_open','rustselectmenu_close','rustselectmenu_choose','rustselectmenu_setValueText'])if(actual[name])exports[name]=(...args)=>{window.menuProof.calls[name]=(window.menuProof.calls[name]||0)+1;return actual[name](...args)}
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
 const proof=await page.evaluate(()=>window.menuProof);expect(proof.available).toBe(true);expect(proof.calls.rustselectmenu_new).toBe(2);expect(proof.calls.rustselectmenu_setOptions).toBeGreaterThan(0);expect(errors).toEqual([])
 await info.attach('compiled-rust-menus',{body:JSON.stringify(proof),contentType:'application/json'})
})
