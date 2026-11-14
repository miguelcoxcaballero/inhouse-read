// The first loop of the scene's frame (bookshelf-scene.js updateEntries), which hands the entry arena
// what changed since the last frame, on a frame where nothing did: `previous` (1.7.330) wrote every
// entry's flags, drag offsets and column 49 (six reads of what the entry holds) in every frame;
// `current` writes the flags and offsets only for an entry whose DOM was read again, and the pose
// call takes what the host holds from the record the scene refreshes after a change. Without rigid
// bodies (their bay columns are written as before). Node, no DOM. Interleaved rounds, medians.
// node scripts/benchmark-scene-first-loop.mjs [dir with the shelf build]
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {performance} from 'node:perf_hooks';
const dir=resolve(process.argv[2]||'src/wasm/shelf');
const rust=await import(pathToFileURL(dir+'/inhouse_read_shelf.js').href);rust.initSync({module:readFileSync(dir+'/inhouse_read_shelf_bg.wasm')});
const {createSceneEntryFrame,ENTRY_STATE}=await import('../src/js/scene-entry-frame.js');
const median=a=>a.toSorted((x,y)=>x-y)[Math.floor(a.length/2)];
const NO_FLAGS={away:false};
for(const count of [40,120,300]){
 const bookEntries=Array.from({length:count},(_,i)=>({kind:i%23===7?'lamp':i%31===5?'plant':undefined,mount:undefined,row:-1,bits:0,dragNumberX:0,dragNumberY:0,flags:NO_FLAGS,
  domDirty:false,stale:false,state:'',x:i,y:2,width:20,height:200,depth:150,depthInset:0,box:new Float64Array(6),overview:false,
  model:{id:100+i,visible:true,userData:{}},insertion:null,trashDrop:null}));
 const entryFrame=createSceneEntryFrame(rust);entryFrame.bind(bookEntries,true);
 let staticStale=false,censusStale=false;
 const stateFor=entry=>entry.state,completedLegacyInsertionLeases=new Set();
 function previous(){
  for(let index=0;index<bookEntries.length;index++){
   const entry=bookEntries[index],at=index*ENTRY_STATE;
   if(entry.domDirty){entry.domDirty=false;entry.state=stateFor(entry);}
   const plant=entry.kind==='plant',lamp=entry.kind==='lamp',undershelf=lamp&&entry.mount==='undershelf';
   const kind=plant?1:lamp?2:0;
   if(entry.insertion?.complete&&!entry.flags.away){
    if(entry.insertion.nativeLegacyBackground&&entry.insertion.nativeLease)completedLegacyInsertionLeases.add(entry.insertion.nativeLease);
    entry.insertion=null;
   }
   entryFrame.refresh();
   const state=entryFrame.state,insertion=entry.insertion,trashDrop=entry.trashDrop;
   if(staticStale||entry.stale){
    entry.stale=false;
    state[at]=kind;state[at+1]=undershelf?1:0;
    state[at+23]=entry.x;state[at+24]=entry.y;state[at+25]=entry.width;state[at+26]=entry.height;
    state[at+27]=entry.depth;state[at+28]=entry.depthInset;
    state.set(entry.box,at+50);
   }
   state[at+2]=entry.bits;state[at+3]=entry.dragNumberX;state[at+4]=entry.dragNumberY;
   state[at+49]=(trashDrop?1:0)|(insertion?2:0)|(entry.model?4:0)|(entry.overview?8:0)|
    (trashDrop?.complete?16:0)|(insertion?.overlayCanvas?32:0);
  }
  staticStale=false;
 }
 function current(){
  entryFrame.refresh();
  let state=entryFrame.state;
  for(let index=0;index<bookEntries.length;index++){
   const entry=bookEntries[index],at=index*ENTRY_STATE;
   const read=entry.domDirty;
   // Native work (the state's text) may have grown the memory.
   if(read){entry.domDirty=false;entry.state=stateFor(entry);entryFrame.refresh();state=entryFrame.state;}
   const plant=entry.kind==='plant',lamp=entry.kind==='lamp',undershelf=lamp&&entry.mount==='undershelf';
   const kind=plant?1:lamp?2:0;
   if(entry.insertion||entry.trashDrop)censusStale=true;
   if(entry.insertion?.complete&&!entry.flags.away){
    if(entry.insertion.nativeLegacyBackground&&entry.insertion.nativeLease)completedLegacyInsertionLeases.add(entry.insertion.nativeLease);
    entry.insertion=null;
   }
   if(staticStale||entry.stale){
    entry.stale=false;
    state[at]=kind;state[at+1]=undershelf?1:0;
    state[at+23]=entry.x;state[at+24]=entry.y;state[at+25]=entry.width;state[at+26]=entry.height;
    state[at+27]=entry.depth;state[at+28]=entry.depthInset;
    state.set(entry.box,at+50);
   }
   if(read){state[at+2]=entry.bits;state[at+3]=entry.dragNumberX;state[at+4]=entry.dragNumberY;}
  }
  staticStale=false;
  if(censusStale){censusStale=false;entryFrame.hold(bookEntries);}
 }
 const olds=[],news=[];
 for(let round=0;round<25;round++){
  let t=performance.now();for(let i=0;i<20000;i++)previous();olds.push((performance.now()-t)/20000*1000);
  t=performance.now();for(let i=0;i<20000;i++)current();news.push((performance.now()-t)/20000*1000);
 }
 console.log(`${count} entries, the frame's first loop with nothing changed: ${median(olds).toFixed(3)} -> ${median(news).toFixed(3)} us per frame (x${(median(olds)/median(news)).toFixed(2)})`);
 // One book in the air: its class and drag variables change in every frame.
 const olds2=[],news2=[];
 for(let round=0;round<25;round++){
  let t=performance.now();for(let i=0;i<20000;i++){bookEntries[3].domDirty=true;previous();}olds2.push((performance.now()-t)/20000*1000);
  t=performance.now();for(let i=0;i<20000;i++){bookEntries[3].domDirty=true;current();}news2.push((performance.now()-t)/20000*1000);
 }
 console.log(`${count} entries, one book dragged: ${median(olds2).toFixed(3)} -> ${median(news2).toFixed(3)} us per frame (x${(median(olds2)/median(news2)).toFixed(2)})`);
 entryFrame.free();
}
