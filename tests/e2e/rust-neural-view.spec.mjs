import {openCompiledReaderApp} from './helpers/compiled-reader.mjs'
import {test,expect} from '@playwright/test'
import {createServer} from 'vite'
import {createServer as createHttpServer} from 'node:http'
import {readFile} from 'node:fs/promises'
let vite,http,url
test.beforeAll(async()=>{
 const html=await readFile('tests/e2e/fixtures/rust-neural-view.html','utf8')
 vite=await createServer({configFile:false,root:process.cwd(),base:'/inhouse-read/',optimizeDeps:{noDiscovery:true},server:{middlewareMode:true,hmr:false,watch:null},plugins:[{name:'neural-view-fixture',configureServer(server){server.middlewares.use(async(req,res,next)=>{
  if(req.url?.split('?')[0]!=='/inhouse-read/__neural-view')return next()
  try{res.setHeader('Content-Type','text/html; charset=utf-8');res.end(await server.transformIndexHtml('/inhouse-read/__neural-view',html))}catch(e){next(e)}
 })}}]})
 http=createHttpServer(vite.middlewares);await new Promise(r=>http.listen(0,'127.0.0.1',r));url='http://127.0.0.1:'+http.address().port+'/inhouse-read/__neural-view'
})
test.afterAll(async()=>{http?.closeAllConnections();if(http)await new Promise(r=>http.close(r));await vite?.close()})
test('Rust natural voices preserve rows, progress, offers and keyboard focus',async({browser},info)=>{
 const results=[]
 for(const rust of [false,true]){
  const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];page.on('pageerror',e=>errors.push(e.message))
  try{
   await page.goto(url);await page.waitForFunction(()=>window.run);results.push(await page.evaluate(rust=>window.run(rust),rust));expect(errors).toEqual([])
   if(rust){const memory=await page.evaluate(()=>window.memory);expect(memory.after).toBe(memory.before);await info.attach('voice-ui-memory',{body:JSON.stringify(memory),contentType:'application/json'})}
  }finally{await page.close()}
 }
 expect(results[0]).toHaveLength(79);expect(results[1]).toEqual(results[0]);await info.attach('voice-ui-parity',{body:JSON.stringify(results),contentType:'application/json'})
})
test('compiled mobile reader renders the downloadable voice catalogue inside Rust',async({page},info)=>{
 test.setTimeout(60000);await page.setViewportSize({width:390,height:844});await page.emulateMedia({reducedMotion:'reduce'})
 const errors=[];page.on('pageerror',error=>errors.push(error.message))
 await page.addInitScript(()=>{
  window.neuralProof={available:false,calls:{}}
  const observe=result=>{const instance=result.instance||result,actual=instance.exports;if(!actual.rustneuralview_new)return result
   window.neuralProof.available=true;const exports={...actual}
   for(const name of ['rustneuralview_new','rustneuralview_row','rustneuralview_renderOffer','rustneuralview_focusKey','rustneuralview_restoreFocus','rustneuralview_configurePicker','rustneuralview_renderPicker'])if(actual[name])exports[name]=(...args)=>{window.neuralProof.calls[name]=(window.neuralProof.calls[name]||0)+1;return actual[name](...args)}
   const proxy=new Proxy(instance,{get(target,key){return key==='exports'?exports:Reflect.get(target,key,target)}});return result.instance?{...result,instance:proxy}:proxy
  }
  for(const name of ['instantiate','instantiateStreaming'])if(WebAssembly[name]){const original=WebAssembly[name];WebAssembly[name]=async function(...args){return observe(await Reflect.apply(original,WebAssembly,args))}}
 })
 await openCompiledReaderApp(page);await page.locator('#file-picker').setInputFiles('tests/e2e/fixtures/reading-journey.epub')
 await expect(page.locator('foliate-view')).toBeVisible({timeout:45000});await page.getByRole('button',{name:'Escuchar el libro'}).click()
 const voice=page.getByRole('button',{name:/^Voz/});await voice.click();await expect(voice).toHaveAttribute('aria-expanded','true')
 await expect.poll(()=>page.locator('[data-neural-voice]').count()).toBeGreaterThan(0)
 await expect(page.locator('[data-neural-voice]').first()).toContainText('MB');await expect(page.locator('[data-neural-action=install]').first()).toBeVisible()
 await page.keyboard.press('Escape');await expect(voice).toBeFocused()
 // Rows, offers and focus reconciliation now execute directly inside Rust.
 // The 79-state DOM/focus parity case above still exercises each view method;
 // the compiled application must enter the owned picker renderer.
 const proof=await page.evaluate(()=>window.neuralProof);expect(proof.available).toBe(true);expect(proof.calls.rustneuralview_new).toBe(1);for(const name of ['configurePicker','renderPicker'])expect(proof.calls['rustneuralview_'+name]).toBeGreaterThan(0);expect(errors).toEqual([])
 await info.attach('compiled-rust-natural-voices',{body:JSON.stringify(proof),contentType:'application/json'})
})
