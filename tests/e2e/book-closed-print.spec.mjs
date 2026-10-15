import {expect,test} from '@playwright/test';
import {createServer} from 'vite';
import {createServer as createHttpServer} from 'node:http';

const fixture=`<!doctype html><html><body><script type="module">
import * as THREE from 'three';
import '/inhouse-read/tests/e2e/helpers/shelf-ready.js';
import {getBookRenderer,createBookModel,lightBookScene} from '/inhouse-read/src/js/book-model.js';
const renderer=getBookRenderer(),W=390,H=600;
renderer.setPixelRatio(2);renderer.setSize(W,H);document.body.append(renderer.domElement);
const scene=lightBookScene(new THREE.Scene(),renderer);
const camera=new THREE.OrthographicCamera(-195,195,300,-300,.1,10000);camera.position.z=3000;
const model=createBookModel({id:'closed-print',title:'Actual page',author:'Reader',format:'PDF',progressFraction:.35},
 {color:'#41695d',shade:'#2b463d',ink:'#fffaf0',coverRatio:.66,width:40},180,270,40,null,{eagerRelief:false});
scene.add(model);await model.userData.ready;
const source=document.createElement('canvas');source.width=600;source.height=900;
const c=source.getContext('2d');c.fillStyle='#191919';c.fillRect(0,0,600,900);
c.fillStyle='#cccccc';c.font='32px serif';for(let i=0;i<18;i++)c.fillText('The correct saved page, line '+i,30,60+i*44);
const paper=document.createElement('canvas');paper.width=600;paper.height=900;
const p=paper.getContext('2d');p.fillStyle='#ffffff';p.fillRect(0,0,600,900);
p.fillStyle='#151515';p.font='32px serif';for(let i=0;i<18;i++)p.fillText('The correct saved page, line '+i,30,60+i*44);
model.userData.setPageSnapshot({source,width:600,height:900,paper:{source:paper,width:600,height:900},location:{locator:17}});
model.userData.setCoverOpen(0);
const parent=model.getObjectByName('reading-page-print');
const gl=renderer.getContext(),pixels=()=>{const out=new Uint8Array(W*H*16);gl.readPixels(0,0,W*2,H*2,gl.RGBA,gl.UNSIGNED_BYTE,out);return out;};
const render=()=>{renderer.render(scene,camera);return renderer.info.render.calls;};
window.closedPrint={
 compare(angle,pitch,theme){
  model.rotation.set(pitch*Math.PI/180,angle*Math.PI/180,0);model.userData.setPageTheme(theme,false);
  // Parent visibility reproduces the old submission of both saved rasters.
  parent.visible=true;render();const beforeCalls=render(),before=pixels();
  parent.visible=false;const afterCalls=render(),after=pixels();
  let different=0,max=0;for(let i=0;i<before.length;i++){const d=Math.abs(before[i]-after[i]);if(d)different++;max=Math.max(max,d);}
  return {angle,pitch,theme,beforeCalls,afterCalls,different,max};
 },
 reopen(){model.userData.setCoverOpen(1);return {visible:parent.visible,page:model.userData.pageSnapshot.location.locator,textures:model.userData.getPageTextures().length};},
 dispose(){model.userData.dispose();}
};
</script></body></html>`;
let server,httpServer,url;
test.beforeAll(async()=>{
 server=await createServer({configFile:false,root:process.cwd(),base:'/inhouse-read/',server:{middlewareMode:true,hmr:false,watch:null},optimizeDeps:{noDiscovery:true,include:['three']},
 plugins:[{name:'closed-print-fixture',configureServer(vite){vite.middlewares.use(async(req,res,next)=>{
  if(req.url?.split('?')[0]!=='/inhouse-read/__closed-print')return next();
  try{const html=await vite.transformIndexHtml('/inhouse-read/__closed-print',fixture);res.setHeader('Content-Type','text/html');res.end(html);}catch(e){next(e);}
 });}}]});
 httpServer=createHttpServer(server.middlewares);await new Promise(resolve=>httpServer.listen(0,'127.0.0.1',resolve));
 url='http://127.0.0.1:'+httpServer.address().port+'/inhouse-read/__closed-print';
});
test.afterAll(async()=>{httpServer?.closeAllConnections();if(httpServer)await new Promise(resolve=>httpServer.close(resolve));await server?.close();});
test('closed page rasters skip two draws with identical pixels from every side',async({page},info)=>{
 test.setTimeout(90_000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(url);await page.waitForFunction(()=>window.closedPrint);
 const results=[];
 for(const [angle,pitch] of [[0,0],[30,12],[90,0],[150,-15],[180,0],[230,20],[270,0],[330,-12]]){
  for(const theme of [0,.5,1])results.push(await page.evaluate(([a,p,t])=>window.closedPrint.compare(a,p,t),[angle,pitch,theme]));
 }
 await info.attach('closed-print-pixel-contract',{body:JSON.stringify(results),contentType:'application/json'});
 for(const result of results){expect(result.different,JSON.stringify(result)).toBe(0);expect(result.afterCalls).toBe(result.beforeCalls-2);}
 expect(await page.evaluate(()=>window.closedPrint.reopen())).toEqual({visible:true,page:17,textures:2});
 await page.evaluate(()=>window.closedPrint.dispose());expect(errors).toEqual([]);
});
