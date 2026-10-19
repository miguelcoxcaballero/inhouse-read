import {test,expect} from '@playwright/test';
import {createServer} from 'vite';
import {createServer as createHttpServer} from 'node:http';
const html=`<!doctype html><script type="module">
import {analyzeCoverAppearance} from '/inhouse-read/src/js/cover-appearance.js';
import {analyzeCoverAppearance as reference} from '/inhouse-read/tests/unit/helpers/reference-cover-appearance.js';
import {requireRustCore,getRustCoreModule} from '/inhouse-read/src/js/rust-core.js';
window.exercise=async(worker)=>{
 if(!worker)window.Worker=undefined;
 const core=await requireRustCore(),results=[];
 for(const [w,h,title] of [[192,288,'The Quiet Garden'],[128,192,'ALPHA BETA'],[35,42,'Small'],[1,1,''],[80,66,'東京 ñandú']]){
  const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;
  const c=canvas.getContext('2d');c.fillStyle='#2f6b4f';c.fillRect(0,0,w,h);c.fillStyle='#fffaf0';c.font='bold '+Math.max(9,w/10)+'px serif';c.fillText(title,4,Math.max(12,h/4),w-8);
  const url=canvas.toDataURL(),expected=await reference(url,title),actual=await analyzeCoverAppearance(url,title);
  results.push({expected,actual});
 }
 return {results,module:getRustCoreModule() instanceof WebAssembly.Module};
};
</script>`;
let vite,http,url;
test.beforeAll(async()=>{vite=await createServer({configFile:false,root:process.cwd(),base:'/inhouse-read/',optimizeDeps:{noDiscovery:true},server:{middlewareMode:true,hmr:false,watch:null},plugins:[{name:'cover-only-fixture',configureServer(server){server.middlewares.use(async(req,res,next)=>{if(req.url?.split('?')[0]!=='/inhouse-read/__covers')return next();try{res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml('/inhouse-read/__covers',html));}catch(e){next(e);}});}}]});http=createHttpServer(vite.middlewares);await new Promise(r=>http.listen(0,'127.0.0.1',r));url='http://127.0.0.1:'+http.address().port+'/inhouse-read/__covers';});
test.afterAll(async()=>{http?.closeAllConnections();if(http)await new Promise(r=>http.close(r));await vite?.close();});
for(const worker of [true,false])test('exact cover appearance with '+(worker?'real module worker':'only main-thread Rust'),async({page},info)=>{
 test.setTimeout(90000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(url);await page.waitForFunction(()=>window.exercise);
 const result=await page.evaluate(worker=>window.exercise(worker),worker);
 expect(result.module).toBe(true);for(const pair of result.results)expect(pair.actual).toEqual(pair.expected);
 expect(errors).toEqual([]);await info.attach('appearance-parity',{body:JSON.stringify(result),contentType:'application/json'});
});
