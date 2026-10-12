import {test,expect} from '@playwright/test';
import {createServer} from 'vite';
import {createServer as createHttpServer} from 'node:http';
import {pdfImageTrackingPatch} from '../../scripts/pdf-image-tracking-patch.mjs';
const html=`<!doctype html><script type="module">
import {loadRustCore} from '/inhouse-read/src/js/rust-core.js';
import {rustPDFTextStream} from '/inhouse-read/src/js/readers/pdf-stream-wasm.js';
import {assemble as reference} from '/inhouse-read/tests/unit/helpers/reference-pdf-stream.js';
const core=await loadRustCore();if(!core?.pdf_text_stream)throw Error('Actual compiled text stream required');
window.checkStream=()=>{
 const results=[];
 for(const [count,pieces] of [[32,4],[64,4],[128,1],[128,4],[256,1],[256,4],[512,1],[512,4]]){
  let rawIndex=0;const lines=Array.from({length:count},(_,i)=>{let x=30;const entries=Array.from({length:pieces},(_,p)=>{
   const str=p===pieces-1&&i%4===0?'soft­':'A complete Unicode phrase 漢字 🦊 '+p+' ',x0=x;x+=str.length*5+5;
   return {item:{str,hasEOL:true,fontName:'test'},rawIndex:rawIndex++,x0,x1:x-5,y:i*20+20,height:12};
  });return {entries,x0:entries[0].x0,x1:entries.at(-1).x1,y:i*20+20,height:12,column:'body',rtl:false,text:entries.map(e=>e.item.str).join(' ')};});
  const copy=()=>lines.map(line=>({...line})),original=reference(copy()),actual=rustPDFTextStream(copy());
  const canonical=value=>JSON.stringify(value,(_key,value)=>value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b))):value);
  if(canonical(actual)!==canonical(original))throw Error('Text/spans/paragraphs differ');
  const timings={js:[],rust:[]};for(let i=0;i<5;i++){reference(copy());rustPDFTextStream(copy());}
  const before=core.memory.buffer.byteLength;
  for(let round=0;round<9;round++)for(const kind of round%2?['rust','js']:['js','rust']){
   const run=kind==='rust'?rustPDFTextStream:reference,start=performance.now();
   for(let i=0;i<20;i++)run(copy());timings[kind].push((performance.now()-start)/20);
  }
  const median=a=>[...a].sort((a,b)=>a-b)[4];results.push({count,pieces,characters:actual.text.length,js:median(timings.js),rust:median(timings.rust),timings,capacityBefore:before,capacityAfter:core.memory.buffer.byteLength});
 }
 return results;
};
</script>`;
let vite,http,url;
test.beforeAll(async()=>{
 vite=await createServer({configFile:false,root:process.cwd(),base:'/inhouse-read/',optimizeDeps:{noDiscovery:true},server:{middlewareMode:true,hmr:false,watch:null},plugins:[pdfImageTrackingPatch(),{name:'pdf-images-fixture',configureServer(server){server.middlewares.use(async(req,res,next)=>{
  if(req.url?.split('?')[0]!=='/inhouse-read/__pdf_stream')return next();
  try{res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml('/inhouse-read/__pdf_stream',html));}catch(e){next(e);}
 });}}]});
 http=createHttpServer(vite.middlewares);await new Promise(r=>http.listen(0,'127.0.0.1',r));url='http://127.0.0.1:'+http.address().port+'/inhouse-read/__pdf_stream';
});
test.afterAll(async()=>{http?.closeAllConnections();if(http)await new Promise(r=>http.close(r));await vite?.close();});
for(const method of ['checkStream'])test('Rust PDF stream: '+method,async({page},testInfo)=>{
 test.setTimeout(60_000);const cdp=await page.context().newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
 await page.goto(url);await page.waitForFunction(method=>typeof window[method]==='function',method);
 const result=await page.evaluate(method=>window[method](),method);
 if(Array.isArray(result))for(const row of result)expect(row.capacityAfter).toBe(row.capacityBefore);
 else{expect(result.crops).toBe(32);expect(result.renderedImages).toBe(32);}
 console.log(JSON.stringify(result));await testInfo.attach(method,{body:JSON.stringify(result,null,2),contentType:'application/json'});
});
