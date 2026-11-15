// What the scene asks of its entries outside the frame's loops, and the painted room's plan: the
// frozen host code of 1.7.334 (bookshelf-scene.js: hasOngoingMotion's scan, the scans of
// beginInspectionGesture, and draw's cacheInspection/refreshOverview before capturePlan) against
// `still` over the entry arena (rust-ui/src/scene_census.rs) and `paintPlan` (rust-ui/src/scene_plan.rs).
// Node/WASM, no DOM or GPU. Interleaved rounds, medians.
// node scripts/benchmark-scene-still.mjs [dir with the shelf build]
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {performance} from 'node:perf_hooks';
import assert from 'node:assert/strict';
const dir=resolve(process.argv[2]||'src/wasm/shelf');
const rust=await import(pathToFileURL(dir+'/inhouse_read_shelf.js').href);rust.initSync({module:readFileSync(dir+'/inhouse_read_shelf_bg.wasm')});
const {createSceneEntryFrame,ENTRY_STATE:S}=await import('../src/js/scene-entry-frame.js');
const median=a=>a.toSorted((x,y)=>x-y)[Math.floor(a.length/2)];
const room=count=>Array.from({length:count},(_,i)=>({kind:i%23===7?'lamp':i%31===5?'plant':undefined,row:-1,bits:0,
 model:{id:100+i,visible:i%5!==4,userData:{overview:i%2===0,inspectionResolution:i%2?1024:undefined}},
 insertion:null,trashDrop:null,qualityReplacement:false,replacementReady:false,plantQuality:null}));
function compare(label,unit,runs,rounds=41,calls=4000){
 const names=Object.keys(runs),times=Object.fromEntries(names.map(name=>[name,[]]));
 let sink=0;
 for(let warm=0;warm<3000;warm++)for(const name of names)sink+=Number(runs[name](warm));
 for(let round=0;round<rounds;round++)for(const name of round%2?names:names.toReversed()){
  const started=performance.now();
  for(let call=0;call<calls;call++)sink+=Number(runs[name](call));
  times[name].push((performance.now()-started)/calls*1000);
 }
 console.log(label.padEnd(44),names.map(name=>`${name} ${median(times[name]).toFixed(3)} ${unit}`).join('   '),sink?'':'');
}
for(const count of [40,120,300]){
 const entries=room(count),frame=createSceneEntryFrame(rust);
 frame.bind(entries,false);
 const cell=(entry,column)=>(frame.refresh(),frame.state[entry.row*S+column]);
 const easing=entry=>{frame.refresh();const at=entry.row*S;return frame.state[at+9]!==0||frame.state[at+20]!==0;};
 let censusStale=true;
 const tellHeld=()=>{if(censusStale){censusStale=false;frame.hold(entries);}},heldStill=asked=>(tellHeld(),frame.still(asked));
 // hasOngoingMotion's part over the entries: after every painted frame (the arena already holds what the frame told it).
 const ongoingFrozen=()=>entries.some(entry=>entry.insertion&&!entry.insertion.complete||entry.trashDrop&&!entry.trashDrop.complete);
 const ongoing=()=>Boolean(heldStill(2));
 const ongoingStale=()=>{censusStale=true;return Boolean(heldStill(2));};
 assert.equal(ongoing(),ongoingFrozen());
 compare(`ongoing motion, ${count} entries`,'us',{frozen:ongoingFrozen,'arena':ongoing,'arena after a change':ongoingStale});
 // beginInspectionGesture's scans (without the buttons' classes and the lamps, which stay with the host).
 const gestureFrozen=()=>{
  const stationary=entries.every(entry=>!entry.insertion&&!entry.trashDrop&&!easing(entry)&&
   [cell(entry,5),cell(entry,6),cell(entry,7)].every(value=>Math.abs(value)<=.220001));
  return stationary&&entries.some(entry=>cell(entry,5)||cell(entry,6)||cell(entry,7));
 };
 const gesture=()=>{censusStale=true;const held=heldStill(13);return !(held&5)&&Boolean(held&8);};
 assert.equal(gesture(),gestureFrozen());
 compare(`a gesture's start, ${count} entries`,'us',{frozen:gestureFrozen,'arena after a change':gesture},21,1000);
 frame.free();
}
{
 const scene=new rust.RustScene(390,700,390,200,false,true,0),out=new Float64Array(4),sizes=new Float64Array(4);
 scene.measureFit(900,0,800,60,0,false);scene.sizeViewport(700,844,2,sizes);
 const context={},overviewContext={},held=0;
 const frozen=()=>{
  const cacheInspection=context&&scene.progress===1&&true&&!scene.hasDrop;
  const refreshOverview=cacheInspection&&scene.zoom===1&&scene.panX===0&&scene.panY===0&&overviewContext&&!(held&32);
  scene.capturePlan(Boolean(cacheInspection),2,20,60,out);
  return out[0]+(cacheInspection?8:0)+(refreshOverview?16:0);
 };
 const plan=()=>{
  scene.paintPlan((context&&true?1:0)|(overviewContext&&!(held&32)?2:0),2,20,60,out);
  return out[0]+(out[3]&24);
 };
 assert.equal(plan(),frozen());
 compare('the painted room\'s plan','us',{frozen,'paintPlan':plan});
 scene.free();
}
