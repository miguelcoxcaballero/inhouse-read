// One placement preview (called on every drag move): the former host loop, two native calls and a
// temporary array per entry, against one scene_preview_entries call over a packed batch. Same
// inputs, previews asserted equal; Node/WASM, no DOM, GPU or battery measurement.
// node scripts/benchmark-scene-preview-entries.mjs [dir with inhouse_read_shelf.js + _bg.wasm]
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {performance} from 'node:perf_hooks';
import assert from 'node:assert/strict';
const dir=resolve(process.argv[2]||'src/wasm/shelf');
const rust=await import(pathToFileURL(dir+'/inhouse_read_shelf.js').href);
rust.initSync({module:readFileSync(dir+'/inhouse_read_shelf_bg.wasm')});
const median=a=>a.toSorted((x,y)=>x-y)[Math.floor(a.length/2)],results=[];
const fresh=()=>({x:0,y:0,fromX:0,fromY:0,targetX:0,targetY:0,started:0,active:false});
const rows=[{top:20,bottom:220,left:12},{top:260,ceiling:240,bottom:460},{top:500,bottom:700,left:6}];
for(const count of [40,120,300]){
 const make=()=>Array.from({length:count},(_,i)=>({key:`k${i}`,kind:i%7===3?'plant':i%5===2?'lamp':undefined,mount:i%10===2?'undershelf':undefined,
  x:i%9*40+20,y:i%3*240+130,height:150+i%4*10,preview:fresh()}));
 const before=make(),after=make();
 const objects=tick=>before.filter((_,i)=>(i+tick)%3!==0).map((e,i)=>({key:e.key,shelf:i%4,center:i%11===4?NaN:80+(tick*7+i*13)%300}));
 // The former loop, frozen from bookshelf-scene.js.
 const previewIo=new Float64Array(13),previewTarget=new Float64Array(2);
 function previewOffset(entry,x,y,now){
  const preview=entry.preview;
  previewIo.set([preview.x,preview.y,preview.fromX,preview.fromY,preview.targetX,preview.targetY,preview.started,preview.active?1:0,x,y,now,0]);
  rust.scene_preview_offset(previewIo);
  [preview.x,preview.y,preview.fromX,preview.fromY,preview.targetX,preview.targetY,preview.started]=previewIo;
  preview.active=previewIo[7]!==0;
  return previewIo[12]!==0;
 }
 function previous(entries,list,draggedKey,now){
  const placements=new Map(list.map(object=>[String(object.key),object]));let changed=false;
  for(const entry of entries){
   const objectKey=String(entry.key),placement=objectKey!==String(draggedKey)?placements.get(objectKey):null;
   const row=placement&&rows[placement.shelf],center=Number(placement?.center);let x=0,y=0;
   if(row&&Number.isFinite(center)){const undershelf=entry.kind==='lamp'&&entry.mount==='undershelf';
    rust.scene_preview_target(row.left||0,undershelf?row.ceiling??row.top:0,row.bottom,center,entry.x,entry.y,entry.height,undershelf,previewTarget);
    x=previewTarget[0];y=previewTarget[1];}
   changed=previewOffset(entry,x,y,now)||changed;
  }
  return changed;
 }
 let batch=new Float64Array(0);
 function current(entries,list,draggedKey,now){
  const placements=new Map(list.map(object=>[String(object.key),object])),n=entries.length;
  if(batch.length!==n*18)batch=new Float64Array(n*18);const io=batch;
  for(let index=0;index<n;index++){
   const entry=entries[index],at=index*18,preview=entry.preview,objectKey=String(entry.key);
   const placement=objectKey!==String(draggedKey)?placements.get(objectKey):null,row=placement&&rows[placement.shelf],center=Number(placement?.center);
   io[at]=0;
   if(row&&Number.isFinite(center)){const undershelf=entry.kind==='lamp'&&entry.mount==='undershelf';
    io[at]=1;io[at+1]=row.left||0;io[at+2]=undershelf?row.ceiling??row.top:0;io[at+3]=row.bottom;
    io[at+4]=center;io[at+5]=entry.x;io[at+6]=entry.y;io[at+7]=entry.height;io[at+8]=undershelf?1:0;}
   io[at+9]=preview.x;io[at+10]=preview.y;io[at+11]=preview.fromX;io[at+12]=preview.fromY;
   io[at+13]=preview.targetX;io[at+14]=preview.targetY;io[at+15]=preview.started;io[at+16]=preview.active?1:0;
  }
  const changed=rust.scene_preview_entries(io,now,false);
  for(let index=0;index<n;index++){const preview=entries[index].preview,at=index*18+9;
   preview.x=io[at];preview.y=io[at+1];preview.fromX=io[at+2];preview.fromY=io[at+3];
   preview.targetX=io[at+4];preview.targetY=io[at+5];preview.started=io[at+6];preview.active=io[at+7]!==0;}
  return changed;
 }
 for(let tick=0;tick<400;tick++){
  const list=tick%40<3?[]:objects(Math.floor(tick/9)),dragged=tick%5?`k${tick%count}`:undefined,now=tick*8;
  assert.equal(current(after,list,dragged,now),previous(before,list,dragged,now));
  for(let i=0;i<count;i++)for(const key of Object.keys(before[i].preview))assert.ok(Object.is(before[i].preview[key],after[i].preview[key]),`${tick} ${i} ${key}`);
 }
 const loops=200,time=fn=>{const entries=make(),start=performance.now();for(let i=0;i<loops;i++)fn(entries,objects(i>>2),`k${i%count}`,i*8);return(performance.now()-start)/loops;};
 const old=[],batched=[];
 for(let round=0;round<31;round++){if(round%2){batched.push(time(current));old.push(time(previous));}else{old.push(time(previous));batched.push(time(current));}}
 results.push({count,perEntryCallsMs:+median(old).toFixed(4),oneCallMs:+median(batched).toFixed(4),speedup:+(median(old)/median(batched)).toFixed(2)});
}
console.log(JSON.stringify({date:new Date().toISOString(),scope:'placement preview per drag move, Node/WASM, shared host',results},null,1));
