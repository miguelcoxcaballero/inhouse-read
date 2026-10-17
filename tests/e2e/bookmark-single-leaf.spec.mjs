import {test,expect} from '@playwright/test';
import {createServer} from 'vite';
import {createServer as createHttpServer} from 'node:http';
const html=`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{margin:0;background:#e6e3dc}#host{width:390px;height:844px}.ihr-book-canvas{width:100%;height:100%;display:block}</style><div id="host"></div>
<script type="module">
import {loadRustCore} from '/inhouse-read/src/js/rust-core.js';
import {loadRustUI} from '/inhouse-read/src/js/rust-ui.js';
import '/inhouse-read/tests/e2e/helpers/shelf-ready.js';
import {bookView} from '/inhouse-read/src/js/book-model.js';
await loadRustCore();await loadRustUI();
const pose={x:0,y:0,scale:1,angle:65,pitch:22,roll:0,coverOpen:0,bookmarkWithdraw:0,pageTheme:0};
const book={id:'single-leaf-ribbon',title:'The Reading Room',author:'An author',format:'EPUB',progressFraction:.47,coverFinish:'satin'};
const style={color:'#315648',shade:'#203a30',ink:'#e8dbad',coverRatio:.66,width:45,fontFamily:'Georgia',fontCanvasFamily:'Georgia',fontWeight:700};
const view=bookView(document.querySelector('#host'),book,style,{width:210,height:318,thickness:45,viewportWidth:390,viewportHeight:844,centerX:195,centerY:430,initialPose:pose,deferDraw:true});
if(!view)throw Error('Real WebGL view required');await view.ready;
window.ribbonPose=async open=>{view.draw({...pose,coverOpen:open});const image=view.canvas.getContext('2d').getImageData(0,0,view.canvas.width,view.canvas.height);let painted=0;for(let i=3;i<image.data.length;i+=4)if(image.data[i])painted++;return{painted,width:view.canvas.width,height:view.canvas.height};};
window.ribbonReady=true;
</script>`;
let vite,http,url;
test.beforeAll(async()=>{
 vite=await createServer({configFile:false,root:process.cwd(),base:'/inhouse-read/',optimizeDeps:{noDiscovery:true},server:{middlewareMode:true,hmr:false,watch:null},plugins:[{name:'ribbon-review',configureServer(server){server.middlewares.use(async(req,res,next)=>{
  if(req.url?.split('?')[0]!=='/inhouse-read/__ribbon-review')return next();
  try{res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml('/inhouse-read/__ribbon-review',html));}catch(error){next(error);}
 });}}]});
 http=createHttpServer(vite.middlewares);await new Promise(resolve=>http.listen(0,'127.0.0.1',resolve));url=`http://127.0.0.1:${http.address().port}/inhouse-read/__ribbon-review`;
});
test.afterAll(async()=>{http?.closeAllConnections();if(http)await new Promise(resolve=>http.close(resolve));await vite?.close();});
test.use({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});
test('the wider single-leaf ribbon renders in the real closed and opened book',async({page},info)=>{
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto(url);await page.waitForFunction(()=>window.ribbonReady);
 for(const [name,open] of [['closed',0],['opened',.65]]){
  const result=await page.evaluate(open=>window.ribbonPose(open),open);
  expect(result.width).toBe(780);expect(result.height).toBe(1688);expect(result.painted).toBeGreaterThan(1000);
  await page.screenshot({path:info.outputPath(`single-leaf-ribbon-${name}.png`)});
 }
 expect(errors).toEqual([]);
});
