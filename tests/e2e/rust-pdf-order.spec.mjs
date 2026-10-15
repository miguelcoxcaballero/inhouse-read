import {test,expect} from '@playwright/test';
import {createServer} from 'vite';
import {createServer as createHttpServer} from 'node:http';
const html=`<!doctype html><script type="module">
import {loadRustCore} from '/inhouse-read/src/js/rust-core.js';
import {rustPDFOrderLines} from '/inhouse-read/src/js/readers/pdf-order-wasm.js';
import {orderLines as reference} from '/inhouse-read/tests/unit/helpers/reference-pdf-order.js';
// The JavaScript original lives with the frozen references now: it is the one both sides are timed against.
const previous=reference;
const core=await loadRustCore();if(!core?.pdf_order_lines)throw Error('Compiled PDF ordering required');
const line=(x,y,width,height,text)=>({x0:x,x1:x+width,y,height,top:y-height,bottom:y,text,items:[{str:text}]});
window.checkPDFOrder=()=>{
 const results=[];
 for(const columns of [1,2,3])for(const rows of [16,48,128]){
  const lines=[];for(let row=0;row<rows;row++)for(let col=0;col<columns;col++)lines.push(line(col*240,row*18,190,12,'Complete original sentence '+row+'/'+col));
  if(columns>1)lines.push(line(0,rows*9-4,columns*240-30,16,'Spanning section title'));
  for(const rtl of [false,true]){
   const expected=reference(lines,rtl),actual=rustPDFOrderLines(lines,rtl);
   if(JSON.stringify(actual)!==JSON.stringify(expected))throw Error('Reading order differs');
   for(let i=0;i<actual.length;i++)if(actual[i].items!==expected[i].items)throw Error('Source identity changed');
  }
  const timings={js:[],rust:[]};for(let i=0;i<5;i++){previous(lines,false);rustPDFOrderLines(lines,false);}
  const capacity=core.memory.buffer.byteLength;
  for(let round=0;round<9;round++)for(const kind of round%2?['rust','js']:['js','rust']){
   const run=kind==='rust'?rustPDFOrderLines:previous,start=performance.now();
   for(let i=0;i<20;i++)run(lines,false);timings[kind].push((performance.now()-start)/20);
  }
  const median=a=>[...a].sort((a,b)=>a-b)[4];results.push({columns,lines:lines.length,js:median(timings.js),rust:median(timings.rust),timings,capacityBefore:capacity,capacityAfter:core.memory.buffer.byteLength});
 }
 return results;
};
</script>`;
let vite,http,url;
test.beforeAll(async()=>{
 vite=await createServer({configFile:false,root:process.cwd(),base:'/inhouse-read/',optimizeDeps:{noDiscovery:true},server:{middlewareMode:true,hmr:false,watch:null},plugins:[{name:'pdf-order-fixture',configureServer(server){server.middlewares.use(async(req,res,next)=>{
  if(req.url?.split('?')[0]!=='/inhouse-read/__pdf_order')return next();
  try{res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml('/inhouse-read/__pdf_order',html));}catch(e){next(e);}
 });}}]});
 http=createHttpServer(vite.middlewares);await new Promise(r=>http.listen(0,'127.0.0.1',r));url='http://127.0.0.1:'+http.address().port+'/inhouse-read/__pdf_order';
});
test.afterAll(async()=>{http?.closeAllConnections();if(http)await new Promise(r=>http.close(r));await vite?.close();});
test('Rust keeps full PDF line order, paths and source references',async({page},testInfo)=>{
 test.setTimeout(60_000);const cdp=await page.context().newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
 await page.goto(url);await page.waitForFunction(()=>typeof window.checkPDFOrder==='function');
 const result=await page.evaluate(()=>window.checkPDFOrder());
 for(const row of result)expect(row.capacityAfter).toBe(row.capacityBefore);
 console.log(JSON.stringify(result));await testInfo.attach('pdf-order',{body:JSON.stringify(result,null,2),contentType:'application/json'});
});
