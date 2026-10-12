import {test,expect} from '@playwright/test';
import {createServer} from 'vite';
import {createServer as createHttpServer} from 'node:http';
const html=`<!doctype html><script type="module">
import {loadRustCore} from '/inhouse-read/src/js/rust-core.js';
import {rustPlantSoilRows} from '/inhouse-read/src/js/plant-soil-wasm.js';
import {createShelfPlant,plantSurfacesReady} from '/inhouse-read/src/js/shelf-plants.js';
import {soilPainter} from '/inhouse-read/tests/unit/helpers/reference-plant-soil.js';
function reference(kind,w,h,row,count,pigment,data){
 const paint=soilPainter(kind===0?'peat':'grit');
 const texel=[0,0,0,.5,1],byte=v=>Math.round(255*Math.min(1,Math.max(0,v)));
 for(let y=row;y<row+count;y++)for(let x=0;x<w;x++){
  paint((x+.5)/w,(y+.5)/h,x,y,texel);const at=((y-row)*w+x)*4;
  for(let c=0;c<3;c++)pigment[at+c]=byte(texel[c]);pigment[at+3]=data[at+3]=255;data[at]=byte(texel[3]);data[at+1]=byte(texel[4]);data[at+2]=0;
 }
}
window.verifySoil=(kind,w,h,row,count,pigment,data)=>{
 const p=new Uint8Array(pigment.length),d=new Uint8Array(data.length);reference(kind,w,h,row,count,p,d);
 if(pigment.some((v,i)=>v!==p[i])||data.some((v,i)=>v!==d[i]))throw Error('Actual final soil differs');
};
const core=await loadRustCore();if(!core?.plant_soil_rows)throw Error('Compiled soil required');
window.checkSoil=async()=>{
 const models=[];
 for(const [catalogId,potId] of [['monstera','muskot'],['cactus','akerbar']])models.push(createShelfPlant({catalogId,potId,seed:'soil-'+catalogId,height:240,inspectionResolution:1}));
 await plantSurfacesReady();const actualCalls=window.soilStats.calls;for(const model of models)model.userData.dispose();window.soilStats.compare=false;
 const samples=[];
 for(const finish of ['peat','grit'])for(const [w,h]of[[128,128],[256,256]]){
  const kind=finish==='peat'?0:1;
  const pigment=new Uint8Array(w*h*4),data=new Uint8Array(pigment.length);
  const js=()=>reference(kind,w,h,0,h,pigment,data),rust=()=>{for(let row=0;row<h;row+=4)if(!rustPlantSoilRows(core,kind,w,h,row,Math.min(4,h-row),pigment,data))throw Error('Row fallback');};
  const times={js:[],rust:[]};for(let i=0;i<3;i++){js();rust();}window.verifySoil(kind,w,h,0,h,pigment,data);
  for(let r=0;r<9;r++)for(const kind of r%2?['rust','js']:['js','rust']){const start=performance.now();for(let i=0;i<3;i++)(kind==='js'?js:rust)();times[kind].push((performance.now()-start)/3);}
  const median=a=>[...a].sort((a,b)=>a-b)[4];samples.push({finish,w,h,js:median(times.js),rust:median(times.rust),times});
 }
 return{actualCalls,samples,memory:{...window.soilStats}};
};
</script>`;
let vite,http,url;
test.beforeAll(async()=>{
 vite=await createServer({configFile:false,root:process.cwd(),base:'/inhouse-read/',optimizeDeps:{noDiscovery:true},server:{middlewareMode:true,hmr:false,watch:null},plugins:[{name:'soil-fixture',configureServer(server){server.middlewares.use(async(req,res,next)=>{
  if(req.url?.split('?')[0]!=='/inhouse-read/__soil')return next();
  try{res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml('/inhouse-read/__soil',html));}catch(e){next(e);}
 });}}]});
 http=createHttpServer(vite.middlewares);await new Promise(r=>http.listen(0,'127.0.0.1',r));url='http://127.0.0.1:'+http.address().port+'/inhouse-read/__soil';
});
test.afterAll(async()=>{http?.closeAllConnections();if(http)await new Promise(r=>http.close(r));await vite?.close();});
test('actual peat and gravel surfaces use bounded Rust rows with identical final material pixels',async({page},info)=>{
 test.setTimeout(120_000);
 await page.addInitScript(()=>{
  const stats=window.soilStats={calls:0,live:0,peak:0,compare:true,verified:0,mismatches:0,maxRows:0,kinds:[]};
  for(const name of ['instantiate','instantiateStreaming'])if(WebAssembly[name]){
   const original=WebAssembly[name];WebAssembly[name]=async function(...args){
    const result=await original.apply(WebAssembly,args),instance=result.instance||result,core=instance.exports;if(!core.plant_soil_rows)return result;
    const exports={...core,alloc_f64(n){const p=core.alloc_f64(n);if(p){stats.live+=n*8;stats.peak=Math.max(stats.peak,stats.live);}return p;},free_f64(p,n){stats.live-=n*8;return core.free_f64(p,n);},
     plant_soil_rows(kind,w,h,row,count,output){
      if(stats.compare&&!stats.kinds.includes(kind))stats.kinds.push(kind);stats.calls++;stats.maxRows=Math.max(stats.maxRows,count);
      const ok=core.plant_soil_rows(kind,w,h,row,count,output);
      if(stats.compare&&ok===1){try{window.verifySoil(kind,w,h,row,count,new Uint8Array(core.memory.buffer,output,w*count*4),new Uint8Array(core.memory.buffer,output+w*count*4,w*count*4));stats.verified++;}catch(e){stats.mismatches++;throw e;}}
      return ok;
     }};
    return result.instance?{...result,instance:{exports}}:{exports};
   };
  }
 });
 await page.setViewportSize({width:390,height:844});const cdp=await page.context().newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
 await page.goto(url);await page.waitForFunction(()=>window.checkSoil);const result=await page.evaluate(()=>window.checkSoil());
 expect(result.actualCalls).toBeGreaterThanOrEqual(64);expect(result.memory.verified).toBe(result.actualCalls);expect(result.memory.mismatches).toBe(0);expect(result.memory.live).toBe(0);expect(result.memory.maxRows).toBe(4);expect(result.memory.kinds.sort()).toEqual([0,1]);
 await info.attach('actual-pot-soil-and-timing',{body:JSON.stringify(result),contentType:'application/json'});console.log(JSON.stringify(result.samples.map(({times,...entry})=>entry)));
});
