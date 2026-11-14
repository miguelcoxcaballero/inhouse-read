// The scene's census with and without its walk of the entries (bookshelf-scene.js `censusStale`), and
// the recipes of rust-ui/src/scene_events.rs against their frozen JavaScript
// (tests/unit/helpers/reference-scene-events.js). Node/WASM, no DOM or GPU. Interleaved rounds, medians.
// node scripts/benchmark-scene-events.mjs [dir with the shelf build]
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {performance} from 'node:perf_hooks';
const dir=resolve(process.argv[2]||'src/wasm/shelf');
const rust=await import(pathToFileURL(dir+'/inhouse_read_shelf.js').href);rust.initSync({module:readFileSync(dir+'/inhouse_read_shelf_bg.wasm')});
const {createSceneEntryFrame}=await import('../src/js/scene-entry-frame.js');
const reference=await import('../tests/unit/helpers/reference-scene-events.js');
const median=a=>a.toSorted((x,y)=>x-y)[Math.floor(a.length/2)];
function compare(label,unit,loops,before,after){
 const a=[],b=[];
 for(let round=0;round<21;round++){
  let t=performance.now();for(let i=0;i<loops;i++)before(i);a.push((performance.now()-t)/loops*1000);
  t=performance.now();for(let i=0;i<loops;i++)after(i);b.push((performance.now()-t)/loops*1000);
 }
 console.log(`${label}: ${median(a).toFixed(3)} -> ${median(b).toFixed(3)} us ${unit} (x${(median(a)/median(b)).toFixed(2)})`);
}
for(const count of [40,120,300]){
 const entries=Array.from({length:count},(_,i)=>({kind:i%23===7?'lamp':i%31===5?'plant':undefined,row:-1,bits:0,
  model:i%7===6?null:{id:100+i,visible:i%5!==4,userData:{overview:i%2===0,inspectionResolution:i%2?1024:undefined}},
  insertion:null,trashDrop:null,qualityReplacement:false,replacementReady:false,plantQuality:null}));
 const frame=createSceneEntryFrame(rust);frame.bind(entries,true);
 compare(`census, ${count} entries: every frame walks them -> a frame without a change`,'per frame',20000,()=>{frame.hold(entries);frame.census(true);},()=>frame.census(true));
 frame.free();
}
// A solver whose books have come to rest.
const books=Array.from({length:12},(_,i)=>({id:`book:${i}`,x:30+i*45}));
const solver=new rust.RustBookGravity(),scene=new rust.RustScene(600,1200,600,250,false,false,0);
let clock=0;
for(let frame=0;frame<600;frame++){
 scene.beginEntries(clock,false,1,new Float64Array([0,0,0,1]),1,600,0,18);
 const states=new Float64Array(books.length*37),geometry=new Float64Array(books.length*9);
 books.forEach((b,i)=>{states.set([0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,b.x,200,150,200,150,0],i*37);geometry.set([20,0,0,1000,0,600,300,10,0],i*9);});
 solver.step(books.map(b=>b.id),states,geometry,scene,clock,false,new Float64Array(books.length*4));clock+=1000/60;
}
const row={left:0,right:600,bottom:300,ceiling:10},entry={key:'book:5'},width=600;
compare('resolveDropPosition (a drag move over a shelf)','per call',2000,
 i=>reference.resolveDrop(solver,entry,{shelf:0,x:(i%100)/100},row,width,1000),
 i=>{const position={shelf:0,x:(i%100)/100},left=row.left||0,padding=row.padding??16;
  const x=rust.scene_drop_x(solver,entry.key,position.shelf,position.x,left,row.right??width,padding,row.bottom,row.ceiling??row.top,1000);
  return x===undefined?null:{...position,x};});
// The storage the scene writes, as a plain map.
const stored=new Map();
globalThis.localStorage={getItem:key=>stored.has(key)?stored.get(key):null,setItem:(key,value)=>{stored.set(key,String(value));}};
const saved=solver.snapshot(),records=books.map((_,i)=>({id:String(i)})),KEY='inhouse-read-shelf-physics-v1',acknowledge=()=>{};
if(typeof saved==='string'){
 compare('a room at rest, stored (touched)','per save',300,()=>reference.roomSave(rust,saved,records,KEY,true,acknowledge),()=>rust.scene_room_save(saved,records,KEY,true,acknowledge));
 compare('a room at rest, already stored (passive)','per save',300,()=>reference.roomSave(rust,saved,records,KEY,false,acknowledge),()=>rust.scene_room_save(saved,records,KEY,false,acknowledge));
}
const model={userData:{preparePresentation:()=>true,prepareDetailPresentation:()=>true}},idle=()=>{},current=()=>true,retry=()=>{};
{
 const a=[],b=[];
 for(let round=0;round<21;round++){
  let t=performance.now();for(let i=0;i<2000;i++)reference.prepareResting(model,idle,current,retry);await new Promise(done=>setTimeout(done));a.push((performance.now()-t)/2);
  t=performance.now();for(let i=0;i<2000;i++)rust.scene_prepare_resting(model.userData,idle,current,retry);await new Promise(done=>setTimeout(done));b.push((performance.now()-t)/2);
 }
 console.log(`a resting book's preparation, both phases settled: ${median(a).toFixed(3)} -> ${median(b).toFixed(3)} us per preparation`);
}
