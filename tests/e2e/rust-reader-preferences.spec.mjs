import {test,expect} from '@playwright/test'
import {createServer} from 'vite'
import {createServer as createHttpServer} from 'node:http'
const html=`<!doctype html><iframe style="width:390px;height:700px"></iframe><script type="module">
import {loadRustCore} from '/inhouse-read/src/js/rust-core.js';
import {readingCSS} from '/inhouse-read/src/js/readers/reading-preferences.js';
import {readingCSS as reference} from '/inhouse-read/tests/unit/helpers/reference-reading-preferences.js';
const core=await loadRustCore();if(!core?.reader_css)throw Error('Reader CSS kernel required');
const frame=document.querySelector('iframe'),doc=frame.contentDocument;doc.body.innerHTML='<p>Un lector conserva el tamaño y la posición de sus palabras.</p>';const style=doc.createElement('style');doc.head.append(style);
window.checkPreferences=()=>{
 const options=Array.from({length:40},(_,i)=>({theme:['paper','sepia','night','amoled','sage'][i%5],font:['book','classic','sans','mono'][i%4],fontSize:14+i%23,lineHeight:1.2+(i%12)/10}));
 for(const p of options)if(readingCSS(p)!==reference(p))throw Error('CSS changed');
 const run=kind=>{let result=0;for(const p of options){style.textContent=(kind==='rust'?readingCSS:reference)(p);result+=doc.body.getBoundingClientRect().height;}return result};
 for(let i=0;i<3;i++){run('js');run('rust');}const before=core.memory.buffer.byteLength,timings={js:[],rust:[]};let consumed=0;
 for(let i=0;i<9;i++)for(const kind of i%2?['rust','js']:['js','rust']){const start=performance.now();consumed+=run(kind);timings[kind].push((performance.now()-start)/40);}
 const median=a=>[...a].sort((a,b)=>a-b)[4];return{js:median(timings.js),rust:median(timings.rust),timings,consumed,before,after:core.memory.buffer.byteLength};
};</script>`
let vite,http,url
test.beforeAll(async()=>{
 vite=await createServer({configFile:false,root:process.cwd(),base:'/inhouse-read/',optimizeDeps:{noDiscovery:true},server:{middlewareMode:true,hmr:false,watch:null},plugins:[{name:'preferences-fixture',configureServer(server){server.middlewares.use(async(req,res,next)=>{
  if(req.url?.split('?')[0]!=='/inhouse-read/__preferences')return next()
  try{res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml('/inhouse-read/__preferences',html))}catch(e){next(e)}
 })}}]})
 http=createHttpServer(vite.middlewares);await new Promise(r=>http.listen(0,'127.0.0.1',r));url='http://127.0.0.1:'+http.address().port+'/inhouse-read/__preferences'
})
test.afterAll(async()=>{http?.closeAllConnections();if(http)await new Promise(r=>http.close(r));await vite?.close()})
test('Rust reader CSS matches and benchmarks full style application and layout',async({page},info)=>{
 const cdp=await page.context().newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:4})
 await page.goto(url);await page.waitForFunction(()=>typeof window.checkPreferences==='function')
 const proof=await page.evaluate(()=>window.checkPreferences());expect(proof.after).toBe(proof.before)
 console.log(JSON.stringify(proof));await info.attach('reader-style-benchmark',{body:JSON.stringify(proof),contentType:'application/json'})
})
test('compiled mobile reader retains exact paragraph layout and appearance controls with Rust',async({browser},info)=>{
 test.setTimeout(120000);const results=[]
 for(const enabled of [false,true]){
  const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true,deviceScaleFactor:1})
  try{
   const page=await context.newPage();await page.emulateMedia({reducedMotion:'reduce'})
   await page.addInitScript(enabled=>{
    localStorage.setItem('inhouse-read-reading-preferences',JSON.stringify({theme:'amoled',font:'sans',fontSize:23,lineHeight:1.7,margin:12,fontWeight:500,rate:1.25}))
    window.readerRustProof={available:false,normalize:0,css:0}
    const observe=result=>{const instance=result.instance||result,actual=instance.exports;if(!actual.reader_css)return result
     window.readerRustProof.available=true;const exports={...actual}
     for(const [name,counter] of [['reader_preferences','normalize'],['reader_css','css'],['reader_nearest_rate',null]])exports[name]=enabled?(...args)=>{if(counter)window.readerRustProof[counter]++;return actual[name](...args)}:undefined
     const proxy=new Proxy(instance,{get(target,key){return key==='exports'?exports:Reflect.get(target,key,target)}});return result.instance?{...result,instance:proxy}:proxy
    }
    for(const name of ['instantiate','instantiateStreaming'])if(typeof WebAssembly[name]==='function'){const original=WebAssembly[name];WebAssembly[name]=async function(...args){return observe(await Reflect.apply(original,WebAssembly,args))}}
   },enabled)
   const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(process.env.IHR_TEST_URL||'./');await page.waitForFunction(()=>window.readerRustProof.available)
   await page.locator('#file-picker').setInputFiles('tests/e2e/fixtures/reading-journey.epub')
   await expect(page.locator('foliate-view')).toBeVisible({timeout:60000})
   await page.waitForFunction(()=>document.querySelector('foliate-view')?.renderer?.getContents?.()[0]?.doc?.body?.textContent?.trim())
   await page.getByRole('button',{name:'Aspecto de lectura'}).click()
   await expect(page.getByRole('slider',{name:'Tamaño de letra',exact:true})).toHaveValue('23')
   await page.getByRole('button',{name:'Sepia',exact:true}).click()
   await page.getByRole('combobox',{name:'Tipografía de lectura'}).selectOption('mono')
   await page.getByRole('slider',{name:'Tamaño de letra',exact:true}).fill('26')
   await page.getByRole('button',{name:'Cerrar opciones de lectura'}).click()
   await page.evaluate(async()=>{const doc=document.querySelector('foliate-view').renderer.getContents()[0].doc;await doc.fonts.ready;for(let i=0;i<4;i++)await new Promise(requestAnimationFrame)})
   const result=await page.evaluate(()=>{
    const view=document.querySelector('foliate-view'),doc=view.renderer.getContents()[0].doc
    return {preferences:JSON.parse(localStorage.getItem('inhouse-read-reading-preferences')),paragraphs:[...doc.querySelectorAll('p')].map(p=>{const r=p.getBoundingClientRect(),s=doc.defaultView.getComputedStyle(p);return{text:p.textContent,box:[r.x,r.y,r.width,r.height],font:s.fontFamily,size:s.fontSize,lineHeight:s.lineHeight,color:s.color}}),proof:window.readerRustProof}
   })
   expect(result.paragraphs.length).toBeGreaterThan(0);expect(errors).toEqual([])
   if(enabled){expect(result.proof.normalize).toBeGreaterThan(0);expect(result.proof.css).toBeGreaterThan(0)}else expect(result.proof.css).toBe(0)
   results.push(result)
  }finally{await context.close()}
 }
 expect({...results[0],proof:null}).toEqual({...results[1],proof:null})
 await info.attach('reader-parity',{body:JSON.stringify(results),contentType:'application/json'})
})
