import {test,expect} from '@playwright/test';
import {createServer} from 'vite';
import {createServer as createHttpServer} from 'node:http';
const html=`<!doctype html><script type="module">
import {loadRustCore} from '/inhouse-read/src/js/rust-core.js';
import {sniffBytes} from '/inhouse-read/src/js/format-detect.js';
import {sniffBytes as original} from '/inhouse-read/tests/unit/helpers/reference-format-detect.js';
const core=await loadRustCore();if(!core?.sniff_book_format)throw Error('Actual format kernel required');
window.checkFormat=()=>{
 const ascii=s=>Uint8Array.from(s,c=>c.charCodeAt(0)), mobi=new Uint8Array(200);mobi.set(ascii('BOOKMOBI'),60);
 const fixtures={pdf:ascii('%PDF-1.7'),zip:Uint8Array.of(80,75,3,4),mobi,fb2:ascii('<?xml version="1.0"?><FictionBook/>'),unknown:new Uint8Array(200)},result=[];
 for(const [name,bytes] of Object.entries(fixtures)){
  if(JSON.stringify(sniffBytes(bytes))!==JSON.stringify(original(bytes)))throw Error(name+' changed');
  const run=kind=>{let total=0;for(let i=0;i<5000;i++)total+=(kind==='rust'?sniffBytes:original)(bytes).confidence.length;return total};
  for(let i=0;i<4;i++){run('js');run('rust');}
  const before=core.memory.buffer.byteLength,timings={js:[],rust:[]};let consumed=0;
  for(let r=0;r<9;r++)for(const kind of r%2?['rust','js']:['js','rust']){const start=performance.now();consumed+=run(kind);timings[kind].push((performance.now()-start)/5000);}
  const median=a=>[...a].sort((a,b)=>a-b)[4];
  result.push({name,js:median(timings.js),rust:median(timings.rust),timings,before,after:core.memory.buffer.byteLength,consumed});
 }return result;
};</script>`;
let vite,http,url;
test.beforeAll(async()=>{
 vite=await createServer({configFile:false,root:process.cwd(),base:'/inhouse-read/',optimizeDeps:{noDiscovery:true},server:{middlewareMode:true,hmr:false,watch:null},plugins:[{name:'format-fixture',configureServer(server){server.middlewares.use(async(req,res,next)=>{
  if(req.url?.split('?')[0]!=='/inhouse-read/__format')return next();
  try{res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml('/inhouse-read/__format',html));}catch(e){next(e);}
 });}}]});
 http=createHttpServer(vite.middlewares);await new Promise(r=>http.listen(0,'127.0.0.1',r));url='http://127.0.0.1:'+http.address().port+'/inhouse-read/__format';
});
test.afterAll(async()=>{http?.closeAllConnections();if(http)await new Promise(r=>http.close(r));await vite?.close();});
test('complete format detection keeps results and bounded memory with mobile CPU throttling',async({page},testInfo)=>{
 const cdp=await page.context().newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
 await page.goto(url);await page.waitForFunction(()=>typeof window.checkFormat==='function');
 const result=await page.evaluate(()=>window.checkFormat());for(const row of result)expect(row.after).toBe(row.before);
 console.log(JSON.stringify(result));await testInfo.attach('format-benchmark',{body:JSON.stringify(result,null,2),contentType:'application/json'});
});
test('compiled mobile app imports and renders FB2 through the real Rust kernel',async({browser},testInfo)=>{
 test.setTimeout(90000);const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 try{
  const page=await context.newPage();await page.emulateMedia({reducedMotion:'reduce'});
  await page.addInitScript(()=>{
   window.formatProof={available:false,calls:0};
   const observe=result=>{const instance=result.instance||result,actual=instance.exports;if(typeof actual?.sniff_book_format!=='function')return result;
    window.formatProof.available=true;const exports={...actual,sniff_book_format:(...args)=>{window.formatProof.calls++;return actual.sniff_book_format(...args);}};
    const proxy=new Proxy(instance,{get(target,key){return key==='exports'?exports:Reflect.get(target,key,target);}});return result.instance?{...result,instance:proxy}:proxy;
   };
   for(const name of ['instantiate','instantiateStreaming'])if(typeof WebAssembly[name]==='function'){const original=WebAssembly[name];WebAssembly[name]=async function(...args){return observe(await Reflect.apply(original,WebAssembly,args));};}
  });
  const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(process.env.IHR_TEST_URL||'./');await page.waitForFunction(()=>window.formatProof.available);
  const xml='<?xml version="1.0" encoding="utf-8"?><FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0"><description><title-info><genre>prose</genre><author><first-name>Ana</first-name><last-name>Prueba</last-name></author><book-title>Format Proof</book-title><lang>es</lang></title-info></description><body><section><title><p>El jardín</p></title><p>Las hojas verdes conservan todas sus palabras.</p><p>Esta segunda frase también permanece completa.</p></section></body></FictionBook>';
  await page.locator('#file-picker').setInputFiles({name:'format-proof.fb2',mimeType:'application/x-fictionbook+xml',buffer:Buffer.from(xml)});
  await expect(page.locator('foliate-view')).toBeVisible({timeout:60000});
  await expect.poll(()=>page.evaluate(()=>document.querySelector('foliate-view')?.renderer?.getContents?.()[0]?.doc?.body?.textContent),{timeout:30000}).toContain('Esta segunda frase también permanece completa.');
  const proof=await page.evaluate(()=>window.formatProof);expect(proof.calls).toBeGreaterThan(0);expect(errors).toEqual([]);
  await testInfo.attach('format-proof',{body:JSON.stringify(proof),contentType:'application/json'});await testInfo.attach('fb2-reader',{body:await page.screenshot(),contentType:'image/png'});
 }finally{await context.close();}
});
