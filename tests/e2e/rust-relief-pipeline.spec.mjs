import {test,expect} from '@playwright/test';
import {createServer} from 'vite';
import {createServer as httpServer} from 'node:http';
const html=`<!doctype html><script type="module">
import {loadRustCore} from '/inhouse-read/src/js/rust-core.js';
import {loadRustShelf} from '/inhouse-read/src/js/rust-shelf.js';
import {wasmRenderRelief,wasmHeightToNormals,wasmComposeReliefLayers,wasmReliefRgbaPlanes} from '/inhouse-read/src/js/cover-relief-wasm.js';
import {buildReliefMaps,updateReliefMapStrengths} from '/inhouse-read/src/js/cover-relief.js';
import {mapsFor,layers} from '/inhouse-read/tests/helpers/cover-relief-reference.mjs';
const core=await loadRustCore();await loadRustShelf();
const drain=task=>{for(;;){const step=task.next();if(step.done)return step.value;}};
const exact=(a,b)=>{if(a.length!==b.length||a.some((value,i)=>value!==b[i]))throw Error('Different pixel bytes');};
window.reliefPipelineCheck=async()=>{
 const checks=[];
 for(const [width,height]of [[17,19],[128,193],[512,512]])for(const compose of [false,true]){
  const maps=mapsFor(width,height),unit=.6/255/(2*(200/Math.max(width,height)));
  const pixels=compose?drain(wasmComposeReliefLayers(core,maps,layers)):maps;
  const normal=drain(wasmHeightToNormals(core,pixels,unit,{selectionAlpha:true}));
  const planes=wasmReliefRgbaPlanes(core,pixels),actual=drain(wasmRenderRelief(core,maps,unit,{selectionAlpha:true,rgba:true,...(compose?{layers}:{})}));
  exact(actual.normal,normal);for(const key of ['height','foil','gloss'])exact(actual[key],planes[key]);
  checks.push({width,height,compose,comparedBytes:normal.length+planes.height.length*3});
 }
 const canvas=document.createElement('canvas');canvas.width=64;canvas.height=96;
 const ctx=canvas.getContext('2d');ctx.fillStyle='#c42532';ctx.fillRect(0,0,32,96);ctx.fillStyle='#234dbc';ctx.fillRect(32,0,32,96);
 const selection={layers:[{id:'color-1',color:'#c42532',tolerance:6,strength:.7},{id:'color-2',color:'#234dbc',tolerance:6,strength:.3}]};
 const built=await buildReliefMaps(canvas,selection,{maxSize:96,selectionAlpha:true});
 const snapshot=built.normal.slice(),selected={layers:selection.layers.map(layer=>({...layer,strength:1-layer.strength}))};
 const changed=await updateReliefMapStrengths(built,selected);
 exact(built.normal,snapshot);if(changed.normal===built.normal||changed.pixels===built.pixels)throw Error('Published maps mutated');
 const reference=drain(wasmComposeReliefLayers(core,built.pixels,[...selected.layers].sort((a,b)=>a.color.localeCompare(b.color))));
 exact(changed.normal,drain(wasmHeightToNormals(core,reference,.6/255/(2*(200/96)),{selectionAlpha:true})));
 const controller=new AbortController();controller.abort();let aborted=false;
 try{await updateReliefMapStrengths(built,selected,{signal:controller.signal});}catch(error){aborted=error.name==='AbortError';}
 if(!aborted)throw Error('Cancellation ignored');
 return{checks,productionBake:true,strengthUpdate:true,cancelled:true};
};
</script>`;
let vite,server,url;
test.beforeAll(async()=>{
 vite=await createServer({configFile:false,root:process.cwd(),base:'/inhouse-read/',optimizeDeps:{noDiscovery:true},server:{middlewareMode:true,hmr:false,watch:null},plugins:[{name:'relief-pipeline-fixture',configureServer(vite){vite.middlewares.use(async(req,res,next)=>{
  if(req.url?.split('?')[0]!=='/inhouse-read/__relief-pipeline')return next();
  try{res.setHeader('Content-Type','text/html');res.end(await vite.transformIndexHtml('/inhouse-read/__relief-pipeline',html));}catch(e){next(e);}
 });}}]});server=httpServer(vite.middlewares);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));url='http://127.0.0.1:'+server.address().port+'/inhouse-read/__relief-pipeline';
});
test.afterAll(async()=>{server?.closeAllConnections();if(server)await new Promise(resolve=>server.close(resolve));await vite?.close();});
test('actual browser relief bake and strength update keep exact pixels and cancellation',async({page},info)=>{
 const errors=[];page.on('pageerror',error=>errors.push(error.message));await page.goto(url);await page.waitForFunction(()=>typeof window.reliefPipelineCheck==='function');
 const result=await page.evaluate(()=>window.reliefPipelineCheck());expect(errors).toEqual([]);expect(result.checks).toHaveLength(6);expect(result.productionBake).toBe(true);expect(result.strengthUpdate).toBe(true);expect(result.cancelled).toBe(true);
 await info.attach('relief-pipeline-proof.json',{body:JSON.stringify(result,null,2),contentType:'application/json'});
});
