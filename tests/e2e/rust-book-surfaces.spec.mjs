import {expect,test} from '@playwright/test';
import {createServer} from 'vite';
import {createServer as createHttpServer} from 'node:http';
const html=`<!doctype html><script type="module">
import {loadRustCore} from '/inhouse-read/src/js/rust-core.js';
import {rustBookSurfacePixels,rustRibbonNotchPixels,rustBookWeavePixels} from '/inhouse-read/src/js/book-surface-wasm.js';
import {clothNormals,paperNormals,ribbonNotch} from '/inhouse-read/tests/unit/helpers/reference-book-surfaces.js';
import {bookWeave} from '/inhouse-read/tests/unit/helpers/reference-book-weave.js';
import '/inhouse-read/tests/e2e/helpers/shelf-ready.js';
import {paintWeave} from '/inhouse-read/src/js/spine-surface.js';
import {createBookModel} from '/inhouse-read/src/js/book-model.js';
import {releaseRustBookmarkBuffers} from '/inhouse-read/src/js/bookmark-wasm.js';
const core=await loadRustCore();if(!core?.book_surface_pixels)throw new Error('Compiled surface kernel required');
const stats=window.surfaceStats;
const hash=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
const join=tiles=>{const out=new Uint8Array(131072);out.set(tiles.color);out.set(tiles.channels,65536);return out;};
const refs={cloth:clothNormals,paper:paperNormals,ribbon:ribbonNotch,weave:()=>join(bookWeave())};
const make=kind=>kind==='weave'?join(rustBookWeavePixels(core)):kind==='ribbon'?rustRibbonNotchPixels(core):rustBookSurfacePixels(core,kind);
window.surfaceWork={
 async measure(kind){
  const before=performance.now(),first=make(kind),coldMs=performance.now()-before;
  const expected=refs[kind](),same=first.every((v,i)=>v===expected[i]);
  for(let i=0;i<3;i++){refs[kind]();make(kind);}
  const rounds={js:[],rust:[]},count=30;
  for(let r=0;r<9;r++)for(const engine of r%2?['rust','js']:['js','rust']){
   const fn=engine==='js'?refs[kind]:()=>make(kind),start=performance.now();
   for(let i=0;i<count;i++)fn();rounds[engine].push((performance.now()-start)/count);
  }
  const median=a=>[...a].sort((a,b)=>a-b)[Math.floor(a.length/2)];
  return {kind,coldMs,bytes:first.length,same,sha256:await hash(first),rounds,
    medianMs:{js:median(rounds.js),rust:median(rounds.rust)},memory:{...stats}};
 },
 async weaveIntegration(){
  const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');
  const tiles=[],createPattern=ctx.createPattern;
  ctx.createPattern=function(tile,...args){
   const pixels=tile.getContext('2d').getImageData(0,0,128,128).data;
   tiles.push(pixels);return createPattern.call(this,tile,...args);
  };
  const before={...stats};paintWeave(ctx,200);paintWeave(ctx,200,{channels:true});
  const after={...stats};paintWeave(ctx,140);paintWeave(ctx,140,{channels:true});
  const expected=bookWeave();
  // Canvas stores premultiplied colors: transparent RGB is quantized on readback.
  // Compare both algorithms after the same real browser upload/readback.
  for(const name of ['color','channels']){
   const ref=document.createElement('canvas');ref.width=128;ref.height=128;
   const rc=ref.getContext('2d');rc.putImageData(new ImageData(expected[name],128,128),0,0);
   expected[name]=rc.getImageData(0,0,128,128).data;
  }
  return {before,after,cached:{...stats},same:tiles.every((p,i)=>p.every((v,j)=>v===expected[i%2?'channels':'color'][j])),
   expectedSha256:await hash(join(expected)),sha256:await hash(join({color:tiles[0],channels:tiles[1]}))};
 },
 async integration(){
  const c=document.createElement('canvas');c.width=200;c.height=300;const ctx=c.getContext('2d');
  ctx.fillStyle='#41695d';ctx.fillRect(0,0,200,300);ctx.fillStyle='#f3e2c8';ctx.fillRect(20,30,160,60);
  const book={id:'rust-surfaces',title:'Microdetail',format:'PDF',progressFraction:.4},style={color:'#41695d',shade:'#2b463d',ink:'#fffaf0',coverRatio:.66,width:40};
  const before={...stats},a=createBookModel(book,style,180,270,40,c.toDataURL(),{eagerRelief:false});await a.userData.ready;
  const seen=new Map();a.traverse(mesh=>{for(const material of [mesh.material].flat())if(material){
   for(const name of ['normalMap','alphaMap']){const t=material[name];if(t?.image?.data)seen.set(t.source,{data:t.image.data,width:t.image.width,height:t.image.height,
    minFilter:t.minFilter,magFilter:t.magFilter,wrapS:t.wrapS,wrapT:t.wrapT,mipmaps:t.generateMipmaps});}
  }});
  const rasters=[];for(const t of seen.values())rasters.push({...t,data:undefined,sha256:await hash(t.data)});
  const after={...stats},b=createBookModel({...book,id:'second'},style,180,270,40,c.toDataURL(),{eagerRelief:false});await b.userData.ready;
  const cached={...stats};a.userData.dispose();b.userData.dispose();
  // Existing per-core bookmark geometry scratch survives model disposal by design, and so does the one
  // small arena of the view arithmetic (rust-core/src/book_view.rs), created by the first model.
  const retainedBookmarkScratch={...stats};releaseRustBookmarkBuffers(core);
  return {before,after,cached,rasters,retainedBookmarkScratch,memory:{...stats}};
 }
};
</script>`;
let vite,http,url;
test.beforeAll(async()=>{
 vite=await createServer({configFile:false,root:process.cwd(),base:'/inhouse-read/',
  optimizeDeps:{noDiscovery:true,include:['three']},server:{middlewareMode:true,hmr:false,watch:null},
  plugins:[{name:'surface-fixture',configureServer(server){server.middlewares.use(async(req,res,next)=>{
   if(req.url?.split('?')[0]!=='/inhouse-read/__surfaces')return next();
   try{res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml('/inhouse-read/__surfaces',html));}catch(e){next(e);}
  });}}]});
 http=createHttpServer(vite.middlewares);await new Promise(resolve=>http.listen(0,'127.0.0.1',resolve));
 url='http://127.0.0.1:'+http.address().port+'/inhouse-read/__surfaces';
});
test.afterAll(async()=>{http?.closeAllConnections();if(http)await new Promise(resolve=>http.close(resolve));await vite?.close();});
test.use({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});
test('compiled book surfaces retain exact pixels, shared textures and bounded memory',async({page},info)=>{
 test.setTimeout(120_000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
  const stats=window.surfaceStats={surfaces:0,ribbons:0,weaves:0,allocations:0,releases:0,live:0,peak:0};
  for(const name of ['instantiate','instantiateStreaming'])if(WebAssembly[name]){
   const original=WebAssembly[name];WebAssembly[name]=async function(...args){
    const result=await original.apply(WebAssembly,args),instance=result.instance||result,core=instance.exports;
    if(!core.book_surface_pixels)return result;
    const exports={...core,
     book_weave_pixels(...args){stats.weaves++;return core.book_weave_pixels(...args);},
     alloc_f64(n){const p=core.alloc_f64(n);if(p){stats.allocations++;stats.live+=n*8;stats.peak=Math.max(stats.peak,stats.live);}return p;},
     free_f64(p,n){stats.releases++;stats.live-=n*8;core.free_f64(p,n);},
     book_surface_pixels(...args){stats.surfaces++;return core.book_surface_pixels(...args);},
     book_ribbon_notch(...args){stats.ribbons++;return core.book_ribbon_notch(...args);}};
    const wrapped=new Proxy(instance,{get(target,key){return key==='exports'?exports:Reflect.get(target,key,target);}});
    return result.instance?{...result,instance:wrapped}:wrapped;
   };
  }
 });
 const cdp=await page.context().newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
 await page.goto(url);await page.waitForFunction(()=>window.surfaceWork);
 const results=[];for(const kind of ['cloth','paper','ribbon','weave'])results.push(await page.evaluate(kind=>window.surfaceWork.measure(kind),kind));
 const woven=await page.evaluate(()=>window.surfaceWork.weaveIntegration());
 const integrated=await page.evaluate(()=>window.surfaceWork.integration());
 await info.attach('rust-book-surface-measurements',{body:JSON.stringify({results,woven,integrated},null,2),contentType:'application/json'});
 for(const r of results){expect(r.same).toBe(true);expect(r.memory.live).toBe(0);expect(r.memory.allocations).toBe(r.memory.releases);}
 expect(woven.same).toBe(true);expect(woven.sha256).toBe(woven.expectedSha256);
 expect(woven.after.weaves-woven.before.weaves).toBe(1);expect(woven.cached.weaves).toBe(woven.after.weaves);
 expect(woven.cached.live).toBe(0);expect(integrated.cached.weaves).toBe(woven.cached.weaves);
 expect(integrated.after.surfaces-integrated.before.surfaces).toBe(2);
 expect(integrated.after.ribbons-integrated.before.ribbons).toBe(1);
 expect(integrated.cached.surfaces).toBe(integrated.after.surfaces);expect(integrated.cached.ribbons).toBe(integrated.after.ribbons);
 for(const r of results.filter(r=>r.kind!=='weave'))expect(integrated.rasters.map(t=>t.sha256)).toContain(r.sha256);
 expect(integrated.retainedBookmarkScratch.live-integrated.before.live).toBe(18016+2432);
 expect(integrated.memory.live-integrated.before.live).toBe(2432);
 expect(integrated.memory.allocations-integrated.before.allocations).toBe(integrated.memory.releases-integrated.before.releases+1);expect(errors).toEqual([]);
});
