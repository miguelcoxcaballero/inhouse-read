import {test,expect} from '@playwright/test'
import {createServer} from 'vite'
import {createServer as createHttpServer} from 'node:http'
import {readFile} from 'node:fs/promises'
let vite,http,url
test.beforeAll(async()=>{
 const html=await readFile('tests/e2e/fixtures/rust-reader-view.html','utf8')
 vite=await createServer({configFile:false,root:process.cwd(),base:'/inhouse-read/',optimizeDeps:{noDiscovery:true},server:{middlewareMode:true,hmr:false,watch:null},plugins:[{name:'reader-view-fixture',configureServer(server){server.middlewares.use(async(req,res,next)=>{
  if(req.url?.split('?')[0]!=='/inhouse-read/__reader-view')return next()
  try{res.setHeader('Content-Type','text/html; charset=utf-8');res.end(await server.transformIndexHtml('/inhouse-read/__reader-view',html))}catch(e){next(e)}
 })}}]})
 http=createHttpServer(vite.middlewares);await new Promise(r=>http.listen(0,'127.0.0.1',r));url='http://127.0.0.1:'+http.address().port+'/inhouse-read/__reader-view'
})
test.afterAll(async()=>{http?.closeAllConnections();if(http)await new Promise(r=>http.close(r));await vite?.close()})
for(const incremental of [false,true])test(`Rust reader view preserves 100 exact DOM and control states (incremental=${incremental})`,async({browser},info)=>{
 const results=[]
 for(const rust of [false,true]){
  const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];page.on('pageerror',e=>errors.push(e.message))
  try{await page.goto(url);await page.waitForFunction(()=>window.run);results.push(await page.evaluate(({rust,incremental})=>window.run(rust,true,incremental),{rust,incremental}));expect(errors).toEqual([])}finally{await page.close()}
 }
 expect(results[0]).toHaveLength(100);expect(results[1]).toEqual(results[0]);await info.attach('reader-view-parity',{body:JSON.stringify(results),contentType:'application/json'})
})
for(const incremental of [false,true])test(`complete reader view DOM updates keep bounded memory under mobile CPU throttling (incremental=${incremental})`,async({page},info)=>{
 const cdp=await page.context().newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:4})
 await page.goto(url);await page.waitForFunction(()=>window.benchmark);const result=await page.evaluate(incremental=>window.benchmark(incremental),incremental)
 expect(result.memoryAfter).toBe(result.memoryBefore);console.log(JSON.stringify(result));await info.attach('reader-view-benchmark',{body:JSON.stringify(result),contentType:'application/json'})
})
test('compiled mobile reader updates themes, tabs and audio controls through Rust',async({page},info)=>{
 test.setTimeout(60000);await page.setViewportSize({width:390,height:844});await page.emulateMedia({reducedMotion:'reduce'})
 const errors=[];page.on('pageerror',e=>errors.push(e.message))
 await page.addInitScript(()=>{
  window.viewProof={available:false,calls:{}}
  const observe=result=>{const instance=result.instance||result,actual=instance.exports;if(!actual.rustreaderview_new)return result
   window.viewProof.available=true;const exports={...actual}
   for(const name of ['rustreaderview_new','rustreaderview_showTab','rustreaderview_showPlaceTab','rustreaderview_applyPreferences','rustreaderview_updateMiniPlayer','rustreaderview_updateBookmarkButton','rustreaderview_updateReturnButton'])exports[name]=(...args)=>{window.viewProof.calls[name]=(window.viewProof.calls[name]||0)+1;return actual[name](...args)}
   const proxy=new Proxy(instance,{get(target,key){return key==='exports'?exports:Reflect.get(target,key,target)}});return result.instance?{...result,instance:proxy}:proxy
  }
  for(const name of ['instantiate','instantiateStreaming'])if(WebAssembly[name]){const original=WebAssembly[name];WebAssembly[name]=async function(...args){return observe(await Reflect.apply(original,WebAssembly,args))}}
 })
 await page.goto(process.env.IHR_TEST_URL||'./')
 // This case proves the compiled component. The intentionally stalled-download
 // case separately proves fallback and adoption on the already-open document.
 await expect.poll(()=>page.evaluate(()=>window.viewProof.available)).toBe(true)
 await page.locator('#file-picker').setInputFiles('tests/e2e/fixtures/reading-journey.epub');await expect(page.locator('foliate-view')).toBeVisible({timeout:45000})
 await page.getByRole('button',{name:'Aspecto de lectura'}).click();await page.getByRole('button',{name:'AMOLED',exact:true}).click();await expect(page.locator('#reader-screen')).toHaveAttribute('data-reading-theme','amoled')
 await page.getByRole('button',{name:'Cerrar opciones de lectura'}).click();await page.locator('#reader-location').click();await page.getByRole('button',{name:'Marcar esta página',exact:true}).click();await expect(page.locator('[data-bookmark]')).toHaveAttribute('aria-pressed','true')
 await page.getByRole('button',{name:'Cerrar opciones de lectura'}).click();await page.getByRole('button',{name:'Escuchar el libro'}).click();await expect(page.getByRole('button',{name:'Reproducir',exact:true})).toBeVisible()
 const proof=await page.evaluate(()=>window.viewProof);expect(proof.available).toBe(true);expect(proof.calls.rustreaderview_new).toBe(1)
 for(const name of ['showTab','showPlaceTab','applyPreferences','updateMiniPlayer','updateBookmarkButton','updateReturnButton'])expect(proof.calls['rustreaderview_'+name]).toBeGreaterThan(0)
 expect(errors).toEqual([]);await info.attach('compiled-reader-view',{body:JSON.stringify(proof),contentType:'application/json'})
})
