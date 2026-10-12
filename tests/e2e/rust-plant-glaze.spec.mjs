import {test,expect} from '@playwright/test';
import {createServer} from 'vite';
import {createServer as createHttpServer} from 'node:http';
const html=`<!doctype html><script type="module">
import {loadRustCore} from '/inhouse-read/src/js/rust-core.js';
import {rustPlantGlazeRows} from '/inhouse-read/src/js/plant-glaze-wasm.js';
import {createShelfPlant,plantSurfacesReady} from '/inhouse-read/src/js/shelf-plants.js';
import {glazedPainter} from '/inhouse-read/tests/unit/helpers/reference-plant-glaze.js';
const hex=values=>'#'+Array.from(values,v=>Math.round(v*255).toString(16).padStart(2,'0')).join('');
function reference(w,h,row,count,cfg,pigment,data){
 const paint=glazedPainter({glaze:hex(cfg.subarray(0,3)),body:hex(cfg.subarray(3,6)),gloss:cfg[6],speckle:cfg[7],crackle:cfg[8],seed:cfg[9]});
 const texel=[0,0,0,.5,1],byte=v=>Math.round(255*Math.min(1,Math.max(0,v)));
 for(let y=row;y<row+count;y++)for(let x=0;x<w;x++){
  paint((x+.5)/w,(y+.5)/h,x,y,texel);const at=((y-row)*w+x)*4;
  for(let c=0;c<3;c++)pigment[at+c]=byte(texel[c]);pigment[at+3]=data[at+3]=255;data[at]=byte(texel[3]);data[at+1]=byte(texel[4]);data[at+2]=0;
 }
}
window.verifyGlaze=(w,h,row,count,cfg,pigment,data)=>{
 const p=new Uint8Array(pigment.length),d=new Uint8Array(data.length);reference(w,h,row,count,cfg,p,d);
 if(pigment.some((v,i)=>v!==p[i])||data.some((v,i)=>v!==d[i]))throw Error('Actual final glaze differs');
};
const core=await loadRustCore();if(!core?.plant_glaze_rows)throw Error('Compiled glaze required');
window.checkGlaze=async()=>{
 const models=[];
 for(const [catalogId,potId] of [['monstera','muskot'],['sansevieria','gradvis']])models.push(createShelfPlant({catalogId,potId,seed:'glaze-'+catalogId,height:240,inspectionResolution:1}));
 await plantSurfacesReady();const actualCalls=window.glazeStats.calls;for(const model of models)model.userData.dispose();window.glazeStats.compare=false;
 const samples=[],rgb=hex=>[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255);
 for(const finish of ['muskot','gradvis'])for(const [w,h]of[[128,256],[256,512]]){
  const cfg=finish==='muskot'?new Float64Array([...rgb('#ffffff'),...rgb('#cfbea3'),.24,.0022,.55,17]):new Float64Array([...rgb('#dbacb6'),...rgb('#c7a291'),.42,.004,0,29]);
  const pigment=new Uint8Array(w*h*4),data=new Uint8Array(pigment.length);
  const js=()=>reference(w,h,0,h,cfg,pigment,data),rust=()=>{for(let row=0;row<h;row+=4)if(!rustPlantGlazeRows(core,w,h,row,Math.min(4,h-row),cfg,pigment,data))throw Error('Row fallback');};
  const times={js:[],rust:[]};for(let i=0;i<3;i++){js();rust();}window.verifyGlaze(w,h,0,h,cfg,pigment,data);
  for(let r=0;r<9;r++)for(const kind of r%2?['rust','js']:['js','rust']){const start=performance.now();for(let i=0;i<3;i++)(kind==='js'?js:rust)();times[kind].push((performance.now()-start)/3);}
  const median=a=>[...a].sort((a,b)=>a-b)[4];samples.push({finish,w,h,js:median(times.js),rust:median(times.rust),times});
 }
 return{actualCalls,samples,memory:{...window.glazeStats}};
};
</script>`;
let vite,http,url;
test.beforeAll(async()=>{
 vite=await createServer({configFile:false,root:process.cwd(),base:'/inhouse-read/',optimizeDeps:{noDiscovery:true},server:{middlewareMode:true,hmr:false,watch:null},plugins:[{name:'glaze-fixture',configureServer(server){server.middlewares.use(async(req,res,next)=>{
  if(req.url?.split('?')[0]!=='/inhouse-read/__glaze')return next();
  try{res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml('/inhouse-read/__glaze',html));}catch(e){next(e);}
 });}}]});
 http=createHttpServer(vite.middlewares);await new Promise(r=>http.listen(0,'127.0.0.1',r));url='http://127.0.0.1:'+http.address().port+'/inhouse-read/__glaze';
});
test.afterAll(async()=>{http?.closeAllConnections();if(http)await new Promise(r=>http.close(r));await vite?.close();});
test('actual glazed pots use bounded Rust rows with identical final material pixels',async({page},info)=>{
 test.setTimeout(120_000);
 await page.addInitScript(()=>{
  const stats=window.glazeStats={calls:0,live:0,peak:0,compare:true,verified:0,mismatches:0,maxRows:0};
  for(const name of ['instantiate','instantiateStreaming'])if(WebAssembly[name]){
   const original=WebAssembly[name];WebAssembly[name]=async function(...args){
    const result=await original.apply(WebAssembly,args),instance=result.instance||result,core=instance.exports;if(!core.plant_glaze_rows)return result;
    const exports={...core,alloc_f64(n){const p=core.alloc_f64(n);if(p){stats.live+=n*8;stats.peak=Math.max(stats.peak,stats.live);}return p;},free_f64(p,n){stats.live-=n*8;return core.free_f64(p,n);},
     plant_glaze_rows(w,h,row,count,input,output){
      stats.calls++;stats.maxRows=Math.max(stats.maxRows,count);const cfg=stats.compare?new Float64Array(core.memory.buffer,input,10).slice():null;
      const ok=core.plant_glaze_rows(w,h,row,count,input,output);
      if(stats.compare&&ok===1){try{window.verifyGlaze(w,h,row,count,cfg,new Uint8Array(core.memory.buffer,output,w*count*4),new Uint8Array(core.memory.buffer,output+w*count*4,w*count*4));stats.verified++;}catch(e){stats.mismatches++;throw e;}}
      return ok;
     }};
    return result.instance?{...result,instance:{exports}}:{exports};
   };
  }
 });
 await page.setViewportSize({width:390,height:844});const cdp=await page.context().newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
 await page.goto(url);await page.waitForFunction(()=>window.checkGlaze);const result=await page.evaluate(()=>window.checkGlaze());
 expect(result.actualCalls).toBeGreaterThanOrEqual(128);expect(result.memory.verified).toBe(result.actualCalls);expect(result.memory.mismatches).toBe(0);expect(result.memory.live).toBe(0);expect(result.memory.maxRows).toBe(4);
 await info.attach('actual-pot-glaze-and-timing',{body:JSON.stringify(result),contentType:'application/json'});console.log(JSON.stringify(result.samples.map(({times,...entry})=>entry)));
});
