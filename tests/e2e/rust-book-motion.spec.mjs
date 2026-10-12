import {test,expect} from '@playwright/test';
import {createServer} from 'vite';
import {createServer as createHttpServer} from 'node:http';
const html=`<!doctype html><script type="module">
import {loadRustCore} from '/inhouse-read/src/js/rust-core.js';
import {createRustBookMotion,MOTION_KEYS} from '/inhouse-read/src/js/book-motion-wasm.js';
import {sampleBookMotion} from '/inhouse-read/tests/unit/helpers/reference-book-motion.js';
const core=await loadRustCore();if(!core?.book_motion_prepare)throw Error('Compiled motion required');
window.checkBookMotion=()=>{
 const results=[];
 for(const count of [2,4,8,16]){
  const frames=Array.from({length:count},(_,i)=>({offset:i/(count-1),transform:Object.fromEntries(MOTION_KEYS.map((key,k)=>[key,(i%3-1)*(k+1)]))}));
  const motion=createRustBookMotion(frames);if(!motion)throw Error('Kernel rejected motion');
  try{
   for(let i=0;i<=100;i++)if(JSON.stringify(motion.sample(i/100))!==JSON.stringify(sampleBookMotion(frames,i/100)))throw Error('Motion differs at '+i);
   for(let i=0;i<200;i++){motion.sample(i%101/100);sampleBookMotion(frames,i%101/100);}
   const before=core.memory.buffer.byteLength,timings={js:[],rust:[]};
   for(let round=0;round<9;round++)for(const kind of round%2?['rust','js']:['js','rust']){
    const run=kind==='rust'?t=>motion.sample(t):t=>sampleBookMotion(frames,t),start=performance.now();
    for(let i=0;i<2000;i++)run(i%101/100);timings[kind].push((performance.now()-start)/2000);
   }
   const complete={js:[],rust:[]};
   for(let round=0;round<9;round++)for(const kind of round%2?['rust','js']:['js','rust']){
    const start=performance.now();
    for(let i=0;i<100;i++){
     const prepared=kind==='rust'?createRustBookMotion(frames):null;
     try{for(let frame=0;frame<47;frame++)if(prepared)prepared.sample(frame/46);else sampleBookMotion(frames,frame/46);}
     finally{prepared?.dispose();}
    }
    complete[kind].push((performance.now()-start)/100);
   }
   const median=a=>[...a].sort((a,b)=>a-b)[4];results.push({count,js:median(timings.js),rust:median(timings.rust),completeJS:median(complete.js),completeRust:median(complete.rust),timings,complete,capacityBefore:before,capacityAfter:core.memory.buffer.byteLength});
  }finally{motion.dispose();}
 }
 return results;
};
</script>`;
let vite,http,url;
test.beforeAll(async()=>{
 vite=await createServer({configFile:false,root:process.cwd(),base:'/inhouse-read/',optimizeDeps:{noDiscovery:true},server:{middlewareMode:true,hmr:false,watch:null},plugins:[{name:'motion-fixture',configureServer(server){server.middlewares.use(async(req,res,next)=>{
  if(req.url?.split('?')[0]!=='/inhouse-read/__motion')return next();
  try{res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml('/inhouse-read/__motion',html));}catch(e){next(e);}
 });}}]});
 http=createHttpServer(vite.middlewares);await new Promise(r=>http.listen(0,'127.0.0.1',r));url='http://127.0.0.1:'+http.address().port+'/inhouse-read/__motion';
});
test.afterAll(async()=>{http?.closeAllConnections();if(http)await new Promise(r=>http.close(r));await vite?.close();});
test('Rust samples every book pose with identical coordinates and stable memory',async({page},testInfo)=>{
 test.setTimeout(60_000);const cdp=await page.context().newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
 await page.goto(url);await page.waitForFunction(()=>typeof window.checkBookMotion==='function');
 const result=await page.evaluate(()=>window.checkBookMotion());
 for(const row of result)expect(row.capacityAfter).toBe(row.capacityBefore);
 console.log(JSON.stringify(result));await testInfo.attach('book-motion',{body:JSON.stringify(result,null,2),contentType:'application/json'});
});
