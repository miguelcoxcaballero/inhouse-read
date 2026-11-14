// One placement preview (called on every drag move), the host's whole previewPlacements body:
// `previous` is the loop as it stood (eighteen numbers per entry copied from the entry arena into
// a batch, scene_preview_entries over the batch, eight numbers per entry copied back); `current`
// packs ten numbers per placed entry and RustSceneEntryFrame#preview advances the arena's own
// previews. Same inputs, previews asserted equal bit for bit first; Node/WASM, no DOM, GPU or
// battery measurement. Interleaved rounds, medians.
// node scripts/benchmark-scene-preview-arena.mjs [dir with inhouse_read_shelf.js + _bg.wasm]
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {performance} from 'node:perf_hooks';
import assert from 'node:assert/strict';
const dir=resolve(process.argv[2]||'src/wasm/shelf');
const rust=await import(pathToFileURL(dir+'/inhouse_read_shelf.js').href);
rust.initSync({module:readFileSync(dir+'/inhouse_read_shelf_bg.wasm')});
const {createSceneEntryFrame,ENTRY_STATE}=await import('../src/js/scene-entry-frame.js');
const median=a=>a.toSorted((x,y)=>x-y)[Math.floor(a.length/2)],results=[];
const rows=[{top:20,bottom:220,left:12},{top:260,ceiling:240,bottom:460},{top:500,bottom:700,left:6}];
for(const count of [40,120,300]){
 const make=()=>{
  const bookEntries=Array.from({length:count},(_,i)=>({key:`k${i}`,kind:i%7===3?'plant':i%5===2?'lamp':undefined,mount:i%10===2?'undershelf':undefined,
   node:i%4?{dataset:{objectId:`k${i}`}}:null,x:i%9*40+20,y:i%3*240+130,height:150+i%4*10,row:-1}));
  const entryFrame=createSceneEntryFrame(rust);entryFrame.bind(bookEntries,true);
  return {bookEntries,entryFrame,previewBatch:new Float64Array(0)};
 };
 const objects=(entries,tick)=>entries.filter((_,i)=>(i+tick)%3!==0).map((e,i)=>({key:e.key,shelf:i%4,center:i%11===4?NaN:80+(tick*7+i*13)%300}));
 // The former body, from bookshelf-scene.js.
 function previous(c,list,draggedKey,now){
  const {bookEntries,entryFrame}=c;
  const placements=new Map((Array.isArray(list)?list:[]).map(object=>[String(object.key),object]));
  const n=bookEntries.length;
  if(c.previewBatch.length!==n*18)c.previewBatch=new Float64Array(n*18);
  const io=c.previewBatch;
  for(let index=0;index<n;index++){
   const entry=bookEntries[index],at=index*18;
   const objectKey=String(entry.node?.dataset.objectId??entry.key);
   const placement=objectKey!==String(draggedKey)?placements.get(objectKey):null;
   const row=placement&&rows[placement.shelf];
   const center=Number(placement?.center);
   io[at]=0;
   if(row&&Number.isFinite(center)){
    const undershelf=entry.kind==='lamp'&&entry.mount==='undershelf';
    io[at]=1;io[at+1]=row.left||0;io[at+2]=undershelf?row.ceiling??row.top:0;io[at+3]=row.bottom;
    io[at+4]=center;io[at+5]=entry.x;io[at+6]=entry.y;io[at+7]=entry.height;io[at+8]=undershelf?1:0;
   }
   entryFrame.refresh();
   const state=entryFrame.state,from=entry.row*ENTRY_STATE+13;
   for(let field=0;field<7;field++)io[at+9+field]=state[from+field];
   io[at+16]=state[from+7]!==0?1:0;
  }
  const changed=rust.scene_preview_entries(io,now,false);
  entryFrame.refresh();
  for(let index=0;index<n;index++){
   const state=entryFrame.state,to=bookEntries[index].row*ENTRY_STATE+13,at=index*18+9;
   for(let field=0;field<7;field++)state[to+field]=io[at+field];
   state[to+7]=io[at+7]!==0?1:0;
  }
  return changed;
 }
 function current(c,list,draggedKey,now){
  const {bookEntries,entryFrame}=c;
  const placements=new Map((Array.isArray(list)?list:[]).map(object=>[String(object.key),object]));
  const n=bookEntries.length;
  if(c.previewBatch.length<n*10)c.previewBatch=new Float64Array(n*10);
  const io=c.previewBatch;
  let used=0;
  for(let index=0;index<n;index++){
   const entry=bookEntries[index];
   const objectKey=String(entry.node?.dataset.objectId??entry.key);
   const placement=objectKey!==String(draggedKey)?placements.get(objectKey):null;
   const row=placement&&rows[placement.shelf];
   const center=Number(placement?.center);
   if(row&&Number.isFinite(center)){
    const undershelf=entry.kind==='lamp'&&entry.mount==='undershelf';
    io[used]=index;io[used+1]=row.left||0;io[used+2]=undershelf?row.ceiling??row.top:0;io[used+3]=row.bottom;
    io[used+4]=center;io[used+5]=entry.x;io[used+6]=entry.y;io[used+7]=entry.height;io[used+8]=undershelf?1:0;
    used+=10;
   }
  }
  return entryFrame.preview(io.subarray(0,used),now,false);
 }
 {
  const before=make(),after=make();
  for(let tick=0;tick<400;tick++){
   const list=tick%40<3?[]:objects(before.bookEntries,Math.floor(tick/9)),dragged=tick%5?`k${tick%count}`:undefined,now=tick*8;
   assert.equal(current(after,list,dragged,now),previous(before,list,dragged,now));
   before.entryFrame.refresh();after.entryFrame.refresh();
   assert.ok(Buffer.from(before.entryFrame.state.buffer,before.entryFrame.state.byteOffset,before.entryFrame.state.byteLength)
    .equals(Buffer.from(after.entryFrame.state.buffer,after.entryFrame.state.byteOffset,after.entryFrame.state.byteLength)),`tick ${tick}`);
  }
  before.entryFrame.free();after.entryFrame.free();
 }
 // The arrangement's list is built outside the clock: the host receives it from the drag controller.
 const loops=200,sample=make(),lists=Array.from({length:loops},(_,i)=>objects(sample.bookEntries,i>>2));sample.entryFrame.free();
 const time=fn=>{const c=make(),start=performance.now();for(let i=0;i<loops;i++)fn(c,lists[i],`k${i%count}`,i*8);const spent=(performance.now()-start)/loops;c.entryFrame.free();return spent;};
 for(let warm=0;warm<6;warm++){time(previous);time(current);}
 const old=[],arena=[];
 for(let round=0;round<41;round++){if(round%2){arena.push(time(current));old.push(time(previous));}else{old.push(time(previous));arena.push(time(current));}}
 results.push({count,batchCopyMs:+median(old).toFixed(5),arenaMs:+median(arena).toFixed(5),speedup:+(median(old)/median(arena)).toFixed(2)});
}
console.log(JSON.stringify({date:new Date().toISOString(),scope:'placement preview per drag move, whole host body, Node/WASM',results},null,1));
