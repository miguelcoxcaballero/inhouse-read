// The view's and the bin's diagnostics per frame. `previous`: RustScene#transform returns its
// fourteen texts and scene_trash_texts its nine in every frame (each formatted through the
// host's Number#toFixed / toString and sent back as a string), the bin's numbers passed in four
// fresh arrays. `current`: RustScene#transformFresh and #trashTexts answer only when a number
// the texts show moved, from one packed row; the host keeps the texts it holds otherwise.
// The texts are asserted equal first. Node/WASM, no DOM. Interleaved rounds, medians.
// node scripts/benchmark-scene-diagnostic-texts.mjs [dir with inhouse_read_shelf.js + _bg.wasm]
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {performance} from 'node:perf_hooks';
import assert from 'node:assert/strict';
const dir=resolve(process.argv[2]||'src/wasm/shelf');
const rust=await import(pathToFileURL(dir+'/inhouse_read_shelf.js').href);
rust.initSync({module:readFileSync(dir+'/inhouse_read_shelf_bg.wasm')});
const median=a=>a.toSorted((x,y)=>x-y)[Math.floor(a.length/2)],results=[];
const bin=new Float64Array([-40,0,-40,40,140,40,700,-1100,60]);
// `steady`: nothing the texts show moves (a book is dragged, a lamp fades, the page scrolls).
// `inspecting`: the view is zoomed and panned every frame, the bin stands. `all moving`: the
// bin's numbers move every frame too (nothing can be kept: the cost of asking).
for(const mode of ['steady','inspecting','all moving']){
 const make=()=>{const scene=new rust.RustScene(600,1200,600,250,false,true,0);scene.measureFit(844,60,760,60,0,false);return scene;};
 const o=make(),n=make(),out=new Float64Array(8),packed=new Float64Array(17);
 let sink=0,viewTexts=null,trashTexts=null,oldView=null,oldTrash=null;
 const numbers=tick=>{const wobble=mode==='all moving'?tick*.001:0;return [700.5+wobble,-1100.25,60,.8,0,.3,0,-1100.25,-1100,650.123+wobble,900.5,30,650.1+wobble,901,30,44,140];};
 const view=(scene,tick)=>{if(mode!=='steady')scene.setInspection(1.5+Math.sin(tick*.05)*.4,Math.sin(tick*.03)*20,5,true);};
 const previous=tick=>{view(o,tick);const v=numbers(tick);
  oldView=o.transform(bin,-Infinity,true,1,out);
  oldTrash=rust.scene_trash_texts([v[0],v[1],v[2]],v[3],[v[4],v[5],v[6]],v[7],v[8],[v[9],v[10],v[11]],[v[12],v[13],v[14]],v[15],v[16]);
  sink+=oldView.length+oldTrash.length;};
 const current=tick=>{view(n,tick);const v=numbers(tick);
  viewTexts=n.transformFresh(bin,-Infinity,true,1,out)||viewTexts;
  for(let i=0;i<17;i++)packed[i]=v[i];
  trashTexts=n.trashTexts(packed)||trashTexts;
  sink+=viewTexts.length+trashTexts.length;};
 try{
  let clock=0;
  for(;clock<200;clock++){previous(clock);current(clock);assert.deepEqual([...viewTexts],[...oldView]);assert.deepEqual([...trashTexts],[...oldTrash]);}
  const loops=400;let oldTick=clock,newTick=clock;
  const timeOld=()=>{const start=performance.now();for(let i=0;i<loops;i++)previous(oldTick++);return(performance.now()-start)/loops;};
  const timeNew=()=>{const start=performance.now();for(let i=0;i<loops;i++)current(newTick++);return(performance.now()-start)/loops;};
  const old=[],now=[];
  for(let round=0;round<21;round++){if(round%2){now.push(timeNew());old.push(timeOld());}else{old.push(timeOld());now.push(timeNew());}}
  results.push({mode,everyFrameMs:+median(old).toFixed(5),whenMovedMs:+median(now).toFixed(5),speedup:+(median(old)/median(now)).toFixed(2),sink:Number.isFinite(sink)});
 }finally{o.free();n.free();}
}
console.log(JSON.stringify({date:new Date().toISOString(),scope:'view fit and the view\'s and bin\'s diagnostic texts per frame, Node/WASM',results},null,1));
