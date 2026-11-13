// The quality decision of every settled, visible book and plant, per frame. `previous`: one
// rust.scene_update_quality per entry per frame (it stores the frame's overview flag and
// resolution on the entry, compares them with the model's and looks for pending work, all
// through property reads from Rust). `current`: the host stores the two values and makes the
// same comparisons itself (scene-entry-frame.js settledQualityWork), and calls Rust only for an
// entry with work to do: a model at another quality, a pending replacement or plant texture.
// Both sides see the same entries; their state is asserted equal first, with work mixed in.
// Node/WASM, no DOM, GPU or battery measurement. Interleaved rounds, medians.
// node scripts/benchmark-scene-quality-settled.mjs [dir with inhouse_read_shelf.js + _bg.wasm]
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {performance} from 'node:perf_hooks';
import assert from 'node:assert/strict';
const dir=resolve(process.argv[2]||'src/wasm/shelf');
const rust=await import(pathToFileURL(dir+'/inhouse_read_shelf.js').href);
rust.initSync({module:readFileSync(dir+'/inhouse_read_shelf_bg.wasm')});
const {settledQualityWork}=await import('../src/js/scene-entry-frame.js');
const median=a=>a.toSorted((x,y)=>x-y)[Math.floor(a.length/2)],results=[];
function side(count){
 const log=[];
 const makeModel=entry=>({userData:{overview:entry.overview,inspectionResolution:entry.inspectionResolution,ready:null}});
 const entries=Array.from({length:count},(_,i)=>{const entry={kind:i%19===11?'plant':undefined,key:`e:${i}`,node:null,model:null,replacement:null,plantQuality:null,insertion:null,trashDrop:null,
  overview:false,inspectionResolution:0,qualityReplacement:false,replacementReady:false};entry.model=makeModel(entry);return entry;});
 const host={makeModel:entry=>{log.push(['make',entry.key,entry.overview,entry.inspectionResolution]);return makeModel(entry);},cancelReplacement:entry=>{log.push(['cancel',entry.key]);entry.replacement=null;entry.qualityReplacement=entry.replacementReady=false;},
  releaseCandidate(){},furniture:{add(){}},notify(){},batchQuality:false,invalidateCurrent(){},programsChanged(){log.push(['programs']);},watch:(...a)=>{log.push(['watch',a[1].key]);},disposed:false};
 return {entries,host,log};
}
const previous=(c,overview,resolution)=>{for(let i=0;i<c.entries.length;i++)rust.scene_update_quality(c.entries[i],c.host,overview(i),resolution(i));};
const current=(c,overview,resolution)=>{
 for(let i=0;i<c.entries.length;i++){
  const entry=c.entries[i],over=overview(i),res=resolution(i);
  if(settledQualityWork(entry,over,res))rust.scene_update_quality(entry,c.host,over,res);
 }
};
const picture=c=>JSON.stringify([c.entries.map(e=>[e.overview,e.inspectionResolution,e.qualityReplacement,e.replacementReady,Boolean(e.replacement),Boolean(e.plantQuality),e.model.userData.overview,e.model.userData.inspectionResolution]),c.log]);
for(const count of [40,120,300]){
 const o=side(count),n=side(count);
 // Identity with work mixed in: qualities change, replacements are made, become ready, are applied or cancelled.
 for(let tick=0;tick<240;tick++){
  const overview=i=>Math.floor((tick+i)/40)%3===1,resolution=i=>Math.floor((tick+i*3)/60)%4===2?1024:0;
  if(tick%7===3)for(const c of [o,n])for(const e of c.entries)if(e.replacement&&e.qualityReplacement)e.replacementReady=true;
  previous(o,overview,resolution);current(n,overview,resolution);
  assert.equal(picture(n),picture(o),`tick ${tick}`);
 }
 assert.ok(o.log.length>count,'the identity run made replacements');
 // Timing: the steady frame, every model at its entry's quality and nothing pending.
 const steady=side(count),fast=side(count),no=()=>false,zero=()=>0;
 const timeOld=()=>{const start=performance.now();for(let i=0;i<200;i++)previous(steady,no,zero);return(performance.now()-start)/200;};
 const timeNew=()=>{const start=performance.now();for(let i=0;i<200;i++)current(fast,no,zero);return(performance.now()-start)/200;};
 const old=[],now=[];
 for(let round=0;round<21;round++){if(round%2){now.push(timeNew());old.push(timeOld());}else{old.push(timeOld());now.push(timeNew());}}
 assert.equal(picture(fast),picture(steady));
 results.push({count,mode:'settled, nothing to do',perEntryCallMs:+median(old).toFixed(5),hostChecksMs:+median(now).toFixed(5),speedup:+(median(old)/median(now)).toFixed(1)});
}
console.log(JSON.stringify({date:new Date().toISOString(),scope:'quality decision of the settled entries per frame, Node/WASM',results},null,1));
