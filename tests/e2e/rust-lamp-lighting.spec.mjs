import {test,expect} from '@playwright/test';
import {createServer} from 'vite';
import {createServer as createHttpServer} from 'node:http';
// Real Chromium: the Rust shelf module decides which lamps are lit and which light each takes, and aims every light (with the
// browser's own Math.pow for the room's uniformity test). Scripted rooms of lamps go through it and through the frozen
// three.js original into separate scenes, and every light and every answer is compared bit for bit after every frame. Both
// are then timed on the same busy room (alternating, medians).
const html=`<!doctype html><script type="module">
import * as THREE from 'three';
import {loadRustShelf} from '/inhouse-read/src/js/rust-shelf.js';
import {createShelfLampLighting,ensureAreaLights} from '/inhouse-read/src/js/shelf-lamp-lighting.js';
import {createShelfLampLighting as reference,ensureAreaLights as ensureReference} from '/inhouse-read/tests/unit/helpers/reference-shelf-lamp-lighting.js';
import {compareRooms} from '/inhouse-read/tests/unit/helpers/lamp-lighting-scenarios.js';
const shelf=await loadRustShelf();if(!shelf?.lamp_plan)throw Error('Actual shelf module with the lamp lights required');
await Promise.all([ensureAreaLights(),ensureReference()]);
function busyRoom(){
 const room=new THREE.Group(),classes=new Set();
 const entries=Array.from({length:14},(_,index)=>{
  const model=new THREE.Group();model.position.set(index*35-250,-100+(index%3)*40,-80);room.add(model);
  model.userData.lightEmitter={position:[0,-2,0],color:0xffd19a,intensity:10000,distance:400,decay:2,power:1,...(index%2?{direction:[0,-1,0],angle:1.2,penumbra:.5}:{})};
  return {kind:'lamp',key:'lamp:'+index,model,width:40,rect:{top:index*70,bottom:index*70+40},node:{classList:{contains:name=>false}}};
 });
 room.rotation.set(.3,-.6,.1);room.scale.setScalar(1.7);room.updateMatrixWorld(true);
 return {room,entries};
}
function time(create,frames){
 const scene=new THREE.Scene(),manager=create(scene),{room,entries}=busyRoom();
 for(let i=0;i<60;i++)manager.update(entries,{scroll:i*13%700,viewportHeight:600,transform:room.matrixWorld});
 const start=performance.now();
 for(let i=0;i<frames;i++)manager.update(entries,{scroll:i*13%700,viewportHeight:600,transform:room.matrixWorld,shadowDirty:i%97===0});
 const elapsed=(performance.now()-start)/frames;manager.dispose();return elapsed;
}
window.checkLighting=()=>{
 const coverage=compareRooms({createMine:createShelfLampLighting,createReference:reference,seeds:90,frames:30});
 const timings={js:[],rust:[]};
 for(let round=0;round<9;round++)for(const kind of round%2?['rust','js']:['js','rust'])timings[kind].push(time(scene=>(kind==='rust'?createShelfLampLighting:reference)(scene),300));
 const median=a=>[...a].sort((p,q)=>p-q)[4];
 return{coverage,js:median(timings.js),rust:median(timings.rust),handles:shelf.shelf_live_handles()};
};
</script>`;
let vite,http,url;
test.beforeAll(async()=>{
 vite=await createServer({configFile:false,root:process.cwd(),base:'/inhouse-read/',optimizeDeps:{noDiscovery:true},server:{middlewareMode:true,hmr:false,watch:null},plugins:[{name:'lamp-lighting-fixture',configureServer(server){server.middlewares.use(async(req,res,next)=>{
  if(req.url?.split('?')[0]!=='/inhouse-read/__lamp-lighting')return next();
  try{res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml('/inhouse-read/__lamp-lighting',html));}catch(e){next(e);}
 });}}]});
 http=createHttpServer(vite.middlewares);await new Promise(r=>http.listen(0,'127.0.0.1',r));url='http://127.0.0.1:'+http.address().port+'/inhouse-read/__lamp-lighting';
});
test.afterAll(async()=>{http?.closeAllConnections();if(http)await new Promise(r=>http.close(r));await vite?.close();});
test('the lamp lights decided and aimed by the Rust shelf module are bit-identical to the three.js original',async({page},testInfo)=>{
 test.setTimeout(240_000);const cdp=await page.context().newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
 await page.goto(url);await page.waitForFunction(()=>typeof window.checkLighting==='function');
 const result=await page.evaluate(()=>window.checkLighting());
 expect(result.coverage.unexpected,result.coverage.messages.join()).toBe(0);
 expect(result.coverage.frames).toBeGreaterThan(3000);expect(result.coverage.lit).toBeGreaterThan(3000);expect(result.coverage.shadows).toBeGreaterThan(1000);
 console.log(JSON.stringify(result));await testInfo.attach('lamp-lighting',{body:JSON.stringify(result,null,2),contentType:'application/json'});
});
