import {test,expect} from '@playwright/test';
import {createServer} from 'vite';
import {createServer as createHttpServer} from 'node:http';
const html=`<!doctype html><script type="module">
import {loadRustDecorCore} from '/inhouse-read/src/js/rust-decor-core.js';
import {rustPlantPreview} from '/inhouse-read/src/js/plant-preview-wasm.js';
import {createShelfPlant,plantSurfacesReady} from '/inhouse-read/src/js/shelf-plants.js';
import {plantPreview as reference} from '/inhouse-read/tests/unit/helpers/reference-plant-preview.js';
window.verifyPlantBytes=(w,h,lattice,pigment,data)=>{
 const expected=reference(w,h,lattice);
 if(pigment.some((v,i)=>v!==expected.pigment[i])||data.some((v,i)=>v!==expected.data[i]))throw Error('Actual plant texture bytes differ');
};
const core=await loadRustDecorCore();if(!core?.plant_surface_preview)throw Error('Compiled preview required');
window.checkPlants=async()=>{
 const models=[];
 for(const [catalogId,potId] of [['monstera','muskot'],['sansevieria','gradvis'],['cactus','akerbar']])
  models.push(createShelfPlant({catalogId,potId,seed:'rust-'+catalogId,height:240,inspectionResolution:1}));
 const actualCalls=window.plantStats.calls;await plantSurfacesReady();for(const model of models)model.userData.dispose();
 window.plantStats.compare=false;
 const samples=[];
 for(const [width,height] of [[128,128],[128,256],[256,512]]){
  const columns=Math.ceil(width/8)+1,rows=Math.ceil(height/8)+1;let seed=3267;
  const lattice=Float32Array.from({length:columns*rows*5},()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;});
  const pigment=new Uint8Array(width*height*4),data=new Uint8Array(pigment.length);
  const js=()=>reference(width,height,lattice),rust=()=>rustPlantPreview(core,width,height,columns,rows,lattice,pigment,data),times={js:[],rust:[]};
  for(let i=0;i<5;i++){js();rust();}window.verifyPlantBytes(width,height,lattice,pigment,data);
  for(let r=0;r<9;r++)for(const kind of r%2?['rust','js']:['js','rust']){
   const start=performance.now();for(let i=0;i<10;i++)(kind==='js'?js:rust)();times[kind].push((performance.now()-start)/10);
  }
  const median=a=>[...a].sort((a,b)=>a-b)[4];samples.push({width,height,js:median(times.js),rust:median(times.rust),times});
 }
 return {actualCalls,samples,memory:{...window.plantStats}};
};
</script>`;
let vite,http,url;
test.beforeAll(async()=>{
 vite=await createServer({configFile:false,root:process.cwd(),base:'/inhouse-read/',optimizeDeps:{noDiscovery:true},server:{middlewareMode:true,hmr:false,watch:null},
 plugins:[{name:'plant-fixture',configureServer(server){server.middlewares.use(async(req,res,next)=>{
  if(req.url?.split('?')[0]!=='/inhouse-read/__plant')return next();
  try{res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml('/inhouse-read/__plant',html));}catch(e){next(e);}
 });}}]});
 http=createHttpServer(vite.middlewares);await new Promise(r=>http.listen(0,'127.0.0.1',r));url='http://127.0.0.1:'+http.address().port+'/inhouse-read/__plant';
});
test.afterAll(async()=>{http?.closeAllConnections();if(http)await new Promise(r=>http.close(r));await vite?.close();});
test('actual plant materials use compiled previews with identical pigment, relief and roughness',async({page},info)=>{
 test.setTimeout(90_000);
 await page.addInitScript(()=>{
  const stats=window.plantStats={calls:0,live:0,peak:0,compare:true,verified:0,mismatches:0};
  for(const name of ['instantiate','instantiateStreaming'])if(WebAssembly[name]){
   const original=WebAssembly[name];WebAssembly[name]=async function(...args){
    const result=await original.apply(WebAssembly,args),instance=result.instance||result,core=instance.exports;if(!core.plant_surface_preview)return result;
    const exports={...core,alloc_f64(n){const p=core.alloc_f64(n);if(p){stats.live+=n*8;stats.peak=Math.max(stats.peak,stats.live);}return p;},
     free_f64(p,n){stats.live-=n*8;return core.free_f64(p,n);},plant_surface_preview(w,h,cols,rows,input,output){
      stats.calls++;const lattice=stats.compare?new Float32Array(core.memory.buffer,input,cols*rows*5).slice():null;
      const ok=core.plant_surface_preview(w,h,cols,rows,input,output);
      if(stats.compare&&ok===1){
       try{window.verifyPlantBytes(w,h,lattice,new Uint8Array(core.memory.buffer,output,w*h*4),new Uint8Array(core.memory.buffer,output+w*h*4,w*h*4));stats.verified++;}
       catch(error){stats.mismatches++;throw error;}
      }
      return ok;
     }};
    return result.instance?{...result,instance:{exports}}:{exports};
   };
  }
 });
 await page.setViewportSize({width:390,height:844});const cdp=await page.context().newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
 await page.goto(url);await page.waitForFunction(()=>window.checkPlants);const result=await page.evaluate(()=>window.checkPlants());
 expect(result.actualCalls).toBeGreaterThanOrEqual(6);expect(result.memory.live).toBe(0);
 expect(result.memory.verified).toBe(result.actualCalls);expect(result.memory.mismatches).toBe(0);
 await info.attach('actual-plant-textures-and-timing',{body:JSON.stringify(result),contentType:'application/json'});
 console.log(JSON.stringify(result.samples.map(({times,...entry})=>entry)));
});
