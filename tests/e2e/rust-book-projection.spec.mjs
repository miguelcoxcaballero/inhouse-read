import {test,expect} from '@playwright/test'
import {createServer} from 'vite'
import {createServer as createHttpServer} from 'node:http'
import {readFile} from 'node:fs/promises'
import path from 'node:path'
const html=`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{margin:0}.rig{position:relative;width:390px;height:844px}.host{width:100%;height:100%}.ihr-book-canvas{display:block;width:100%;height:100%}</style>
<div class="rig"><div class="host" id="native"></div></div><div class="rig"><div class="host" id="reference"></div></div>
<script type="module">
import {loadRustUI} from '/inhouse-read/src/js/rust-ui.js';
import {loadRustCore} from '/inhouse-read/src/js/rust-core.js';
import {bookView} from '/inhouse-read/src/js/book-model.js';
import {bookView as referenceBookView} from '/inhouse-read/src/js/book-model.js?referenceProjection';
const ui=await loadRustUI();await loadRustCore();if(!ui?.book_projection_bounds)throw Error('Compiled projection required');
window.checkProjectionPixels=async()=>{
 const cover=document.createElement('canvas');cover.width=264;cover.height=400;const coverInk=cover.getContext('2d');
 coverInk.fillStyle='#31536a';coverInk.fillRect(0,0,264,400);coverInk.fillStyle='#d8ac59';coverInk.fillRect(0,250,264,150);coverInk.fillStyle='#fff';coverInk.font='bold 28px Georgia';coverInk.fillText('Projection Proof',18,95);
 const coverUrl=cover.toDataURL('image/png');
 const book={id:'same-projection-book',title:'Projection Proof',author:'Reader',format:'PDF',spineFinish:'gold',spineTextFinish:'silver',coverFinish:'glossy'};
 const style={color:'#31536a',shade:'#223b50',ink:'#ffffff',coverRatio:.66,width:40,fontFamily:'Georgia',fontCanvasFamily:'Georgia',fontWeight:700};
 const origin={x:0,y:0,scale:1,angle:0,pitch:0,roll:0,coverOpen:1,bookmarkWithdraw:1,pageTheme:1};
 const options={width:176,height:420,thickness:40,viewportWidth:390,viewportHeight:844,centerX:195,centerY:350,coverUrl,initialPose:origin,deferDraw:true,compactReturnFrame:true,adaptiveNativeFrame:true};
 const a=bookView(document.querySelector('#native'),book,style,options),b=referenceBookView(document.querySelector('#reference'),book,style,options);
 if(!a||!b)throw Error('Real WebGL views required');
 try{
  await Promise.all([a.ready,b.ready]);
  const page=document.createElement('canvas');page.width=300;page.height=400;const ink=page.getContext('2d');ink.fillStyle='#f5eddd';ink.fillRect(0,0,300,400);ink.fillStyle='#303030';ink.font='20px Georgia';ink.fillText('The saved reading page.',20,65);ink.fillStyle='#26a7bb';ink.fillRect(40,120,180,100);
  const stock=document.createElement('canvas');stock.width=300;stock.height=400;const si=stock.getContext('2d');si.drawImage(page,0,0);si.fillStyle='#ffffff';si.fillRect(0,0,300,35);
  const snapshot={source:page,width:300,height:400,paper:{source:stock,width:300,height:400},engine:'pdf',text:'The saved reading page.',location:{locator:1}};
  if(!a.setPageSnapshot(snapshot,{redraw:false})||!b.setPageSnapshot(snapshot,{redraw:false}))throw Error('Saved page rejected');
  const poses=[{...origin,scale:.55},{...origin,scale:4},{...origin,scale:.65,angle:-24,pitch:9,coverOpen:.65,bookmarkWithdraw:.3},{...origin,scale:.75,angle:45,pitch:7,roll:-3,coverOpen:.2,bookmarkWithdraw:0},{...origin,scale:.55,angle:90,coverOpen:0,bookmarkWithdraw:0},{...origin,scale:.85,angle:-70,pitch:11,coverOpen:0,bookmarkWithdraw:0}];
  const hash=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join(''),rows=[];
  for(const pose of poses){
   a.draw(pose);b.draw(pose);
   const pa=a.canvas.getContext('2d').getImageData(0,0,a.canvas.width,a.canvas.height),pb=b.canvas.getContext('2d').getImageData(0,0,b.canvas.width,b.canvas.height);
   let painted=0,different=0;for(let i=0;i<pa.data.length;i++){if(pa.data[i]!==pb.data[i])different++;if(i%4===3&&pa.data[i])painted++}
   rows.push({pose,nativeHash:await hash(pa.data),referenceHash:await hash(pb.data),different,painted,nativeBounds:JSON.parse(a.canvas.dataset.boardBounds),referenceBounds:JSON.parse(b.canvas.dataset.boardBounds),dimensions:[a.canvas.width,a.canvas.height,b.canvas.width,b.canvas.height]});
  }
  return{rows,projections:window.__projectionCalls||0};
 }finally{a.dispose();b.dispose()}
};
</script>`
let vite,http,url
test.beforeAll(async()=>{
 const source=path.resolve('src/js/book-model.js')
 vite=await createServer({configFile:false,root:process.cwd(),base:'/inhouse-read/',optimizeDeps:{noDiscovery:true},server:{middlewareMode:true,hmr:false,watch:null},plugins:[{
  name:'projection-reference',
  resolveId(id){if(id.endsWith('book-model.js?referenceProjection'))return source+'?referenceProjection'},
  async load(id){if(id===source+'?referenceProjection')return(await readFile(source,'utf8')).replace("import {createBookProjectionPacket,projectVisibleBookBounds} from './book-projection.js';", "import {visibleBounds as projectVisibleBookBounds} from './book-projection-legacy.js';\nconst createBookProjectionPacket=()=>({});")},
  configureServer(server){server.middlewares.use(async(req,res,next)=>{if(req.url?.split('?')[0]!=='/inhouse-read/__projection-pixels')return next();try{res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml('/inhouse-read/__projection-pixels',html))}catch(e){next(e)}})}
 }]})
 http=createHttpServer(vite.middlewares);await new Promise(resolve=>http.listen(0,'127.0.0.1',resolve));url='http://127.0.0.1:'+http.address().port+'/inhouse-read/__projection-pixels'
})
test.afterAll(async()=>{http?.closeAllConnections();if(http)await new Promise(resolve=>http.close(resolve));await vite?.close()})
test.use({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true})
test('Rust projection preserves every rendered pixel, the saved page and the foil materials',async({page},info)=>{
 test.setTimeout(60_000);const errors=[];page.on('pageerror',error=>errors.push(error.message))
 await page.addInitScript(()=>{
  window.__projectionCalls=0
  const observe=result=>{const instance=result.instance||result,actual=instance.exports;if(typeof actual?.book_projection_bounds!=='function')return result;const exports={...actual,book_projection_bounds(...args){window.__projectionCalls++;return actual.book_projection_bounds(...args)}};const observed=new Proxy(instance,{get(target,key){return key==='exports'?exports:Reflect.get(target,key,target)}});return result.instance?{...result,instance:observed}:observed}
  for(const name of ['instantiate','instantiateStreaming'])if(typeof WebAssembly[name]==='function'){const original=WebAssembly[name];WebAssembly[name]=async function(...args){return observe(await Reflect.apply(original,WebAssembly,args))}}
 })
 await page.goto(url);await page.waitForFunction(()=>typeof window.checkProjectionPixels==='function')
 const proof=await page.evaluate(()=>window.checkProjectionPixels())
 await info.attach('real-book-projection-pixels',{body:JSON.stringify(proof,null,2),contentType:'application/json'})
 expect(proof.projections).toBeGreaterThan(0);expect(proof.rows).toHaveLength(6)
 for(const row of proof.rows){expect(row.different).toBe(0);expect(row.nativeHash).toBe(row.referenceHash);expect(row.nativeBounds).toEqual(row.referenceBounds);expect(row.painted).toBeGreaterThan(100);expect(row.dimensions).toEqual([780,1688,780,1688])}
 expect(errors).toEqual([])
})
