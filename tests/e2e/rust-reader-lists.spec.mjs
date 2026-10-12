import {test,expect} from '@playwright/test'
import {createServer} from 'vite'
import {createServer as createHttpServer} from 'node:http'
import {readFile} from 'node:fs/promises'
let vite,http,url
test.beforeAll(async()=>{
 const html=await readFile('tests/e2e/fixtures/rust-reader-lists.html','utf8')
 vite=await createServer({configFile:false,root:process.cwd(),base:'/inhouse-read/',optimizeDeps:{noDiscovery:true},server:{middlewareMode:true,hmr:false,watch:null},plugins:[{name:'reader-lists-fixture',configureServer(server){server.middlewares.use(async(req,res,next)=>{
  if(req.url?.split('?')[0]!=='/inhouse-read/__reader-lists')return next()
  try{res.setHeader('Content-Type','text/html; charset=utf-8');res.end(await server.transformIndexHtml('/inhouse-read/__reader-lists',html))}catch(e){next(e)}
 })}}]})
 http=createHttpServer(vite.middlewares);await new Promise(r=>http.listen(0,'127.0.0.1',r));url='http://127.0.0.1:'+http.address().port+'/inhouse-read/__reader-lists'
})
test.afterAll(async()=>{http?.closeAllConnections();if(http)await new Promise(r=>http.close(r));await vite?.close()})
test('Rust reader lists preserve DOM, object values, callbacks and bounded memory',async({browser},info)=>{
 const results=[]
 for(const rust of [false,true]){
  const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];page.on('pageerror',e=>errors.push(e.message))
  try{
   await page.goto(url);await page.waitForFunction(()=>window.run);results.push(await page.evaluate(rust=>window.run(rust),rust));expect(errors).toEqual([])
   if(rust){const memory=await page.evaluate(()=>window.memory);expect(memory.after).toBe(memory.before);await info.attach('list-memory',{body:JSON.stringify(memory),contentType:'application/json'})}
  }finally{await page.close()}
 }
 expect(results[0]).toHaveLength(17);expect(results[1]).toEqual(results[0]);await info.attach('list-parity',{body:JSON.stringify(results),contentType:'application/json'})
})
test('compiled mobile reader renders bookmarks, chapters and search results through Rust',async({page},info)=>{
 test.setTimeout(60000);await page.setViewportSize({width:390,height:844});await page.emulateMedia({reducedMotion:'reduce'})
 const errors=[];page.on('pageerror',e=>errors.push(e.message))
 await page.addInitScript(()=>{
  window.listsProof={available:false,calls:{}}
  const observe=result=>{const instance=result.instance||result,actual=instance.exports;if(!actual.rustreaderlists_new)return result
   window.listsProof.available=true;const exports={...actual}
   for(const name of ['rustreaderlists_new','rustreaderlists_renderToc','rustreaderlists_renderPlaces','rustreaderlists_clearSearch','rustreaderlists_renderSearch'])exports[name]=(...args)=>{window.listsProof.calls[name]=(window.listsProof.calls[name]||0)+1;return actual[name](...args)}
   const proxy=new Proxy(instance,{get(target,key){return key==='exports'?exports:Reflect.get(target,key,target)}});return result.instance?{...result,instance:proxy}:proxy
  }
  for(const name of ['instantiate','instantiateStreaming'])if(WebAssembly[name]){const original=WebAssembly[name];WebAssembly[name]=async function(...args){return observe(await Reflect.apply(original,WebAssembly,args))}}
 })
 await page.goto(process.env.IHR_TEST_URL||'./');await page.locator('#file-picker').setInputFiles('tests/e2e/fixtures/reading-journey.epub');await expect(page.locator('foliate-view')).toBeVisible({timeout:45000})
 await page.locator('#reader-location').click();await page.getByRole('button',{name:'Marcar esta página',exact:true}).click();await expect(page.locator('[data-bookmark]')).toHaveAttribute('aria-pressed','true')
 await page.getByRole('button',{name:'Cerrar opciones de lectura'}).click();await page.getByRole('button',{name:'Buscar en el libro',exact:true}).click()
 await page.getByRole('searchbox',{name:'Buscar en el libro'}).fill('the');await page.getByRole('button',{name:'Buscar',exact:true}).click()
 await expect(page.locator('[data-search-results] button').first()).toBeVisible();await expect(page.locator('[data-search-results] mark').first()).toBeVisible()
 const proof=await page.evaluate(()=>window.listsProof);expect(proof.available).toBe(true);expect(proof.calls.rustreaderlists_new).toBe(1)
 for(const name of ['renderToc','renderPlaces','clearSearch','renderSearch'])expect(proof.calls['rustreaderlists_'+name]).toBeGreaterThan(0)
 expect(errors).toEqual([]);await info.attach('compiled-reader-lists',{body:JSON.stringify(proof),contentType:'application/json'})
})
