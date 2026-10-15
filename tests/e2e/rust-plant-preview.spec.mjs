import {test,expect} from '@playwright/test';
import {createServer} from 'vite';
import {createServer as createHttpServer} from 'node:http';
// Real Chromium: the decor core draws the coarse first look of every plant surface (its painter on an
// 8-pixel lattice, spread bilinearly). Actual plants are compared byte for byte with the frozen JavaScript
// painters, and the lattice call is timed against them (alternating, medians).
const html=`<!doctype html><script type="module">
import {loadRustDecorCore} from '/inhouse-read/src/js/rust-decor-core.js';
import {loadRustShelf} from '/inhouse-read/src/js/rust-shelf.js';
import {rustPlantLattice} from '/inhouse-read/src/js/plant-lattice-wasm.js';
import {createShelfPlant,plantSurfacesReady} from '/inhouse-read/src/js/shelf-plants.js';
import {createShelfPlant as referencePlant,plantSurfacesReady as referenceReady} from '/inhouse-read/tests/unit/helpers/reference-shelf-plants.js';
import {plantPreview as reference} from '/inhouse-read/tests/unit/helpers/reference-plant-preview.js';
import {glazedPainter} from '/inhouse-read/tests/unit/helpers/reference-plant-glaze.js';
import {terracottaPainter,galvanizedPainter} from '/inhouse-read/tests/unit/helpers/reference-plant-pottery.js';
import {soilPainter} from '/inhouse-read/tests/unit/helpers/reference-plant-soil.js';
import {botanicalTextures} from '/inhouse-read/tests/unit/helpers/reference-plant-foliage.js';
const core=await loadRustDecorCore();if(!core?.plant_surface_lattice)throw Error('Compiled lattice painter required');
// The plants' geometry is the shelf module's: the live shelf awaits it before its first render, so does this page.
if(!await loadRustShelf())throw Error('Rust shelf module required');
const colors=hex=>[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255);
const maps=model=>{const found=[];model.traverse(object=>{const m=object.material;if(m?.map?.image?.data)found.push(m.map.image.data,m.bumpMap.image.data);});return found;};
function hash(x,y,seed){let h=Math.imul(x|0,0x27d4eb2d)^Math.imul(y|0,0x165667b1)^Math.imul(seed|0,0x9e3779b1);h=Math.imul(h^h>>>15,0x85ebca6b);h=Math.imul(h^h>>>13,0xc2b2ae35);return((h^h>>>16)>>>0)/4294967296;}
const same=(a,b)=>a.length===b.length&&a.every((value,i)=>value===b[i]);
function latticeOf(paint,width,height,repeat){
 const columns=Math.ceil(width/8)+1,rows=Math.ceil(height/8)+1,lattice=new Float32Array(columns*rows*5),texel=[0,0,0,.5,1];
 for(let j=0;j<rows;j++)for(let i=0;i<columns;i++){
  const x=i*8>=width?repeat?0:width-1:i*8,y=Math.min(height-1,j*8);paint((x+.5)/width,(y+.5)/height,x,y,texel);lattice.set(texel,(j*columns+i)*5);
 }
 return reference(width,height,lattice);
}
window.checkPlants=async()=>{
 const baseline=window.plantStats.live; // the one permanent 128-byte scratch arena of decor-catalogue.js is already allocated
 const models=[],originals=[],entries=[['monstera','muskot'],['sansevieria','gradvis'],['cactus','akerbar'],['fern','terracotta']];
 for(const [catalogId,potId] of entries){
  const entry={catalogId,potId,seed:'rust-'+catalogId,height:240,inspectionResolution:1};
  models.push(createShelfPlant(entry));originals.push(referencePlant(entry));
 }
 const calls=window.plantStats.calls;
 // First look, before any idle slice has run: identical surfaces.
 let previews=0;
 for(let i=0;i<models.length;i++){const a=maps(models[i]),b=maps(originals[i]);if(a.length!==b.length||a.some((data,k)=>!same(data,b[k])))throw Error('Actual plant texture bytes differ (first look) '+entries[i]);previews+=a.length;}
 await Promise.all([plantSurfacesReady(),referenceReady()]);
 let finals=0;
 for(let i=0;i<models.length;i++){const a=maps(models[i]),b=maps(originals[i]);if(a.some((data,k)=>!same(data,b[k])))throw Error('Actual plant texture bytes differ (final) '+entries[i]);finals+=a.length;}
 for(const model of [...models,...originals])model.userData.dispose();
 const painters=[
  ['glaze',()=>glazedPainter({glaze:'#76a89c',body:'#cfbea3',gloss:.24,speckle:.0022,crackle:.55,seed:17}),{family:0,kind:0,config:new Float64Array([...colors('#76a89c'),...colors('#cfbea3'),.24,.0022,.55,17])},true],
  ['terracotta',()=>terracottaPainter('#a97958',53),{family:1,kind:0,config:new Float64Array([...colors('#a97958'),53])},true],
  ['soil',()=>soilPainter('peat'),{family:2,kind:0},false],
  ['leaf',()=>botanicalTextures('monstera'),{family:3,kind:0,config:new Float64Array([...colors('#2f6128'),hash('monstera'.length,3,11)*Math.PI*2,'monstera'.charCodeAt(0)])},false]
 ];
 const samples=[];
 for(const [name,make,spec,repeat] of painters)for(const [width,height] of [[128,128],[128,256],[256,512]]){
  const pigment=new Uint8Array(width*height*4),data=new Uint8Array(pigment.length),times={js:[],rust:[]};
  const js=()=>latticeOf(make(),width,height,repeat),rust=()=>rustPlantLattice(core,spec,width,height,repeat,pigment,data);
  const expected=js();rust();
  if(!same(pigment,expected.pigment)||!same(data,expected.data))throw Error('Lattice bytes differ '+name);
  for(let r=0;r<9;r++)for(const kind of r%2?['rust','js']:['js','rust']){
   const start=performance.now();for(let i=0;i<5;i++)(kind==='js'?js:rust)();times[kind].push((performance.now()-start)/5);
  }
  const median=a=>[...a].sort((a,b)=>a-b)[4];samples.push({name,width,height,js:median(times.js),rust:median(times.rust)});
 }
 return {calls,baseline,previews,finals,samples,memory:{...window.plantStats}};
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
 test.setTimeout(120_000);
 await page.addInitScript(()=>{
  const stats=window.plantStats={calls:0,live:0,peak:0};
  for(const name of ['instantiate','instantiateStreaming'])if(WebAssembly[name]){
   const original=WebAssembly[name];WebAssembly[name]=async function(...args){
    const result=await original.apply(WebAssembly,args),instance=result.instance||result,core=instance.exports;if(!core.plant_surface_lattice)return result;
    const exports={...core,alloc_f64(n){const p=core.alloc_f64(n);if(p){stats.live+=n*8;stats.peak=Math.max(stats.peak,stats.live);}return p;},
     free_f64(p,n){stats.live-=n*8;return core.free_f64(p,n);},plant_surface_lattice(...input){stats.calls++;return core.plant_surface_lattice(...input);}};
    return result.instance?{...result,instance:{exports}}:{exports};
   };
  }
 });
 await page.setViewportSize({width:390,height:844});const cdp=await page.context().newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
 await page.goto(url);await page.waitForFunction(()=>window.checkPlants);const result=await page.evaluate(()=>window.checkPlants());
 expect(result.calls).toBeGreaterThanOrEqual(6);expect(result.baseline).toBeLessThanOrEqual(128);expect(result.memory.live).toBe(result.baseline);expect(result.previews).toBeGreaterThanOrEqual(12);expect(result.finals).toBeGreaterThanOrEqual(12);
 await info.attach('actual-plant-textures-and-timing',{body:JSON.stringify(result),contentType:'application/json'});
 console.log(JSON.stringify(result.samples));
});
