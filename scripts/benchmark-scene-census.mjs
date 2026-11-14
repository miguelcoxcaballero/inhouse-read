// What a frame asks of its entries after posing them: the frozen host path (1.7.329: the count
// frame's five numbers per entry, the casters' dirty check, scene_quality_hold reading the entry
// objects, the overlay, touched and busy scans and the painted-away set) against the census of
// the entry arena (src/js/scene-entry-frame.js `census`, rust-ui/src/scene_census.rs).
// The frozen path needs a module that still has RustSceneCounts (a build of 1.7.329).
// Node/WASM, no DOM or GPU. Interleaved rounds, medians.
// node scripts/benchmark-scene-census.mjs <dir of a 1.7.329 shelf build> [dir with the current build]
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {performance} from 'node:perf_hooks';
import assert from 'node:assert/strict';
const load=async dir=>{const rust=await import(pathToFileURL(resolve(dir)+'/inhouse_read_shelf.js').href);rust.initSync({module:readFileSync(resolve(dir)+'/inhouse_read_shelf_bg.wasm')});return rust;};
const old=await load(process.argv[2]),rust=await load(process.argv[3]||'src/wasm/shelf');
const {createSceneEntryFrame,ENTRY_STATE:S}=await import('../src/js/scene-entry-frame.js');
const {referenceOverlay,referenceTouched,referenceBusy,referencePaintedAway}=await import('../tests/unit/helpers/reference-scene-census.js');
const median=a=>a.toSorted((x,y)=>x-y)[Math.floor(a.length/2)];
// scene-count-frame.js as of 1.7.329.
function createSceneCountFrame(rust){
 const native=new rust.RustSceneCounts(),memory=native.memory();
 let count=-1,inputAt=0,buffer=null,input,output,text='';
 function refresh(){if(buffer===memory.buffer)return;buffer=memory.buffer;input=new Float64Array(buffer,inputAt,count*5);output=new Float64Array(buffer,native.output_ptr(),8);}
 return {sample(entries,target){
  if(count!==entries.length){count=entries.length;native.resize(count);inputAt=native.input_ptr();buffer=null;}
  refresh();
  for(let index=0;index<count;index++){
   const entry=entries[index],model=entry.model,at=index*5;
   input[at]=entry.kind==='plant'?1:entry.kind==='lamp'?2:0;input[at+1]=model?.visible?1:0;
   input[at+2]=entry.qualityReplacement||entry.plantQuality?1:0;input[at+3]=model?.userData.overview?1:0;input[at+4]=model?.userData.inspectionResolution;
  }
  if(native.sample())text=native.resolutions();
  refresh();target.set(output);return text;
 }};
}
function room(count){
 return Array.from({length:count},(_,i)=>({kind:i%23===7?'lamp':i%31===5?'plant':undefined,row:-1,bits:0,flags:{away:false,pressed:false},
  model:{id:100+i,visible:i%5!==4,userData:{overview:i%2===0,inspectionResolution:i%2?1024:undefined}},
  insertion:null,trashDrop:null,qualityReplacement:false,replacementReady:false,plantQuality:null}));
}
for(const count of [40,120,300]){
 for(const inspecting of [false,true]){
  const entries=room(count),frame=createSceneEntryFrame(rust),countFrame=createSceneCountFrame(old);
  const sceneOld=new old.RustScene(390,700,390,200,false,true,0),scene=new rust.RustScene(390,700,390,200,false,true,0);
  frame.bind(entries,false);
  for(let i=0;i<count;i++)frame.state[i*S]=entries[i].kind==='plant'?1:entries[i].kind==='lamp'?2:0;
  const state={deadline:0,paintDeadline:0},painted=new Set(),countOut=new Float64Array(8),casterIds=new Float64Array(count);
  let casterListDirty=true,casterTrashVisible=null,casterSignature=0,sink=0;
  const cell=(entry,column)=>(frame.refresh(),frame.state[entry.row*S+column]);
  const easing=entry=>{frame.refresh();const at=entry.row*S;return frame.state[at+9]!==0||frame.state[at+20]!==0;};
  // A settled, painted frame of a room with rigid bodies; `inspecting` adds the retained image's questions.
  function frozen(now){
   const trashVisible=true;
   if(casterListDirty||trashVisible!==casterTrashVisible){
    let casterCount=0;
    for(const entry of entries)if(entry.model?.visible)casterIds[casterCount++]=entry.model.id;
    casterSignature=old.scene_casters(trashVisible,casterIds.subarray(0,casterCount));casterListDirty=false;casterTrashVisible=trashVisible;
   }
   const hold=old.scene_quality_hold(entries,state,sceneOld,inspecting,now);
   const overlay=referenceOverlay(entries);
   const refresh=inspecting&&!referenceTouched(entries,entry=>cell(entry,5));
   referencePaintedAway(entries,painted);
   for(const entry of entries)if(entry.insertion?.overlayCanvas)sink++;
   const text=countFrame.sample(entries,countOut);
   const busy=referenceBusy(entries,easing)||referenceBusy(entries,easing);
   return [casterSignature,hold,overlay,refresh,busy,text,...countOut];
  }
  function census(now){
   const held=frame.census(entries,true),casters=frame.counts[0];
   const hold=frame.qualityHold(scene,inspecting,now);
   const overlay=Boolean(held&4),refresh=inspecting&&!(held&32);
   frame.painted();
   if(overlay)for(const entry of entries)if(entry.insertion?.overlayCanvas)sink++;
   frame.refresh();
   const [,a,b,c,d,e,f,g,h]=frame.counts;
   return [casters,hold,overlay,refresh,Boolean(held&16),frame.resolutions,a,b,c,d,e,f,g,h];
  }
  assert.deepEqual(census(1),frozen(1));
  const rounds=41,frames=4000,times={frozen:[],census:[]};
  for(let warm=0;warm<3000;warm++){frozen(warm);census(warm);}
  for(let round=0;round<rounds;round++)for(const [name,run] of round%2?[['frozen',frozen],['census',census]]:[['census',census],['frozen',frozen]]){
   const started=performance.now();
   for(let index=0;index<frames;index++)run(index);
   times[name].push((performance.now()-started)/frames*1000);
  }
  const a=median(times.frozen),b=median(times.census);
  console.log(`${String(count).padStart(3)} entries${inspecting?', retained image':'                '}: frozen ${a.toFixed(3)} µs  census ${b.toFixed(3)} µs  x${(a/b).toFixed(2)}`);
  frame.free();sceneOld.free();scene.free();
 }
}
