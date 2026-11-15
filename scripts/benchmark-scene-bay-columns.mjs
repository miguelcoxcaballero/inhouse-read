// The first loop of the scene's frame with rigid bodies (bookshelf-scene.js updateEntries), on a
// frame where nothing changed: `previous` (1.7.334) wrote every entry's nine solver columns (its
// thickness, kind, shelf, pixels per metre, the bay's four edges and the grip) in every frame;
// `current` writes them with the entry's size and place, only when those changed (a layout, a
// record, a grip). The decoration stamps are compared in both. Node, no DOM. Interleaved rounds, medians.
// node scripts/benchmark-scene-bay-columns.mjs [dir with the shelf build]
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {performance} from 'node:perf_hooks';
import assert from 'node:assert/strict';
const dir=resolve(process.argv[2]||'src/wasm/shelf');
const rust=await import(pathToFileURL(dir+'/inhouse_read_shelf.js').href);rust.initSync({module:readFileSync(dir+'/inhouse_read_shelf_bg.wasm')});
const {createSceneEntryFrame,ENTRY_STATE}=await import('../src/js/scene-entry-frame.js');
const median=a=>a.toSorted((x,y)=>x-y)[Math.floor(a.length/2)];
const NO_FLAGS={away:false},width=390,pixelsPerMetre=650;
const rows=[{top:20,ceiling:12,bottom:220,left:0,right:390},{top:250,ceiling:235,bottom:450},{top:480,bottom:680,left:8}];
for(const count of [40,120,300]){
 const room=()=>Array.from({length:count},(_,i)=>{
  const kind=i%23===7?'lamp':i%31===5?'plant':undefined;
  return {kind,mount:i%46===7?'undershelf':undefined,row:-1,bits:0,dragNumberX:0,dragNumberY:0,flags:NO_FLAGS,domDirty:false,stale:true,state:'',
   x:i,y:2,width:20,height:200,thickness:9+i%5,depth:150,depthInset:0,shelf:i%3,gripHeight:i%7?0:.2,box:new Float64Array(6),overview:false,key:`k${i}`,
   collisionStamp:kind?{height:200,width:20,catalogId:undefined,variant:undefined,potId:undefined,lampId:undefined,pixelsPerMetre}:null,
   model:{id:100+i,visible:true,userData:{}},insertion:null,trashDrop:null};
 });
 const loops={};
 for(const name of ['previous','current']){
  const bookEntries=room(),entryFrame=createSceneEntryFrame(rust);entryFrame.bind(bookEntries,true);
  let staticStale=true,censusStale=true,physicsInteracted=false;
  const stateFor=entry=>entry.state,completedLegacyInsertionLeases=new Set(),bay=name==='previous';
  loops[name]={entryFrame,run(){
   entryFrame.refresh();
   let state=entryFrame.state;
   for(let index=0;index<bookEntries.length;index++){
    const entry=bookEntries[index],at=index*ENTRY_STATE;
    const read=entry.domDirty;
    if(read){entry.domDirty=false;entry.state=stateFor(entry);entryFrame.refresh();state=entryFrame.state;}
    const plant=entry.kind==='plant',lamp=entry.kind==='lamp',undershelf=lamp&&entry.mount==='undershelf';
    const kind=plant?1:lamp?2:0;
    if((plant||lamp)&&!undershelf){
     const stamp=entry.collisionStamp;
     if(!stamp||stamp.height!==entry.height||stamp.width!==entry.width||stamp.catalogId!==entry.catalogId||
       stamp.variant!==entry.variant||stamp.potId!==entry.potId||stamp.lampId!==entry.lampId||stamp.pixelsPerMetre!==pixelsPerMetre)throw new Error('stamp');
    }
    if(entry.bits&6)physicsInteracted=true;
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
     if(!bay){
      const row=rows[entry.shelf||0]||rows[0]||{};
      state[at+40]=kind?entry.width:entry.thickness;state[at+41]=undershelf?3:kind;
      state[at+42]=entry.shelf||0;state[at+43]=pixelsPerMetre;
      state[at+44]=row.left||0;state[at+45]=row.right??width;
      state[at+46]=row.bottom??entry.y+entry.height/2;
      state[at+47]=row.ceiling??row.top??0;state[at+48]=entry.gripHeight||0;
     }
    }
    if(read){state[at+2]=entry.bits;state[at+3]=entry.dragNumberX;state[at+4]=entry.dragNumberY;}
    if(bay){
     const row=rows[entry.shelf||0]||rows[0]||{};
     state[at+40]=kind?entry.width:entry.thickness;state[at+41]=undershelf?3:kind;
     state[at+42]=entry.shelf||0;state[at+43]=pixelsPerMetre;
     state[at+44]=row.left||0;state[at+45]=row.right??width;
     state[at+46]=row.bottom??entry.y+entry.height/2;
     state[at+47]=row.ceiling??row.top??0;state[at+48]=entry.gripHeight||0;
    }
   }
   staticStale=false;
   if(censusStale){censusStale=false;entryFrame.hold(bookEntries);}
   return physicsInteracted;
  }};
 }
 loops.previous.run();loops.current.run();
 // The arenas hold the same numbers after the first frame and after a quiet one.
 for(let pass=0;pass<2;pass++){
  loops.previous.entryFrame.refresh();loops.current.entryFrame.refresh();
  assert.deepEqual(Array.from(new BigUint64Array(loops.current.entryFrame.state.slice().buffer)),Array.from(new BigUint64Array(loops.previous.entryFrame.state.slice().buffer)));
  loops.previous.run();loops.current.run();
 }
 const times={previous:[],current:[]};
 for(let warm=0;warm<5000;warm++){loops.previous.run();loops.current.run();}
 for(let round=0;round<41;round++)for(const name of round%2?['previous','current']:['current','previous']){
  const started=performance.now();
  for(let i=0;i<10000;i++)loops[name].run();
  times[name].push((performance.now()-started)/10000*1000);
 }
 console.log(`${count} entries, rigid bodies, the frame's first loop with nothing changed: ${median(times.previous).toFixed(3)} -> ${median(times.current).toFixed(3)} us per frame (x${(median(times.previous)/median(times.current)).toFixed(2)})`);
 loops.previous.entryFrame.free();loops.current.entryFrame.free();
}
