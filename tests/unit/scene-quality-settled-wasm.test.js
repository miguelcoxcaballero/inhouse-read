// @vitest-environment node
import {expect,it} from 'vitest'
import {rustShelf as rust} from './helpers/rust-shelf-ready.js'
import {settledQualityWork} from '../../src/js/scene-entry-frame.js'

// Every settled entry passes through settledQualityWork in every frame; the scene calls
// scene_update_quality only when it answers true. Over random entry states: both paths leave
// the same entry and make the same host calls, and when the answer is false the Rust call
// changes nothing and calls nothing.
it('skips scene_update_quality exactly when it has nothing to do',()=>{
 let seed=12345;const next=()=>{seed=(seed+0x6D2B79F5)>>>0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}
 const pick=list=>list[Math.floor(next()*list.length)]
 const resolutions=[0,256,1024,2048,undefined,NaN]
 let skipped=0,worked=0,prepared=0
 for(let trial=0;trial<6000;trial++){
  const make=()=>{
   const log=[],data=()=>({overview:pick([false,true,undefined,0,1]),inspectionResolution:pick(resolutions),dispose(){log.push('dispose')},ready:null,
    prepareSurfaceQuality:pick([undefined,resolution=>{log.push(['plan',resolution]);return{ready:null,apply(){log.push('apply')},dispose(){log.push('plan-dispose')}}}])})
   const body=()=>({userData:data(),removeFromParent(){log.push('remove')}})
   const classes=pick([[],['is-away'],['is-dragging']])
   const entry={kind:pick(['plant','lamp',undefined]),model:pick([null,body(),body(),body()]),replacement:pick([null,null,body()]),qualityReplacement:pick([false,false,true]),
    replacementReady:pick([false,true]),plantQuality:null,insertion:pick([null,null,{}]),trashDrop:pick([null,null,{}]),node:pick([null,{classList:{contains:name=>classes.includes(name)}}]),
    overview:pick([false,true]),inspectionResolution:pick([0,256,1024,2048])}
   if(next()<.2)entry.plantQuality={model:pick([entry.model,body()]),plan:{apply(){log.push('pending-apply')},dispose(){log.push('pending-dispose')}},resolution:pick([0,256]),ready:pick([false,true])}
   const env={batchQuality:pick([false,true]),invalidateCurrent(){log.push('invalidate')},makeModel(e){log.push(['make',e.overview,e.inspectionResolution]);return{userData:{overview:e.overview,inspectionResolution:e.inspectionResolution,ready:null,dispose(){log.push('dispose')}},removeFromParent(){log.push('remove')}}},
    cancelReplacement(e){log.push('cancel');e.replacement=null;e.qualityReplacement=e.replacementReady=false},releaseCandidate(){log.push('release')},
    watch(){log.push('watch')},notify(){log.push('notify')},programsChanged(){log.push('programs')},furniture:{add(){log.push('add')}},disposed:false}
   return {entry,env,log}
  }
  // The same random state twice (the generator is replayed), with the same frame decision.
  const state=seed,a=make();seed=state;const b=make()
  const overview=pick([false,true]),resolution=pick([0,256,1024,2048])
  const picture=({entry,log})=>JSON.stringify([entry.overview,entry.inspectionResolution,entry.qualityReplacement,entry.replacementReady,Boolean(entry.replacement),
   Boolean(entry.plantQuality),entry.plantQuality?.resolution,Boolean(entry.model),log],(key,value)=>Number.isNaN(value)?'NaN':value)
  rust.scene_update_quality(a.entry,a.env,overview,resolution)
  const work=settledQualityWork(b.entry,overview,resolution)
  if(work){worked++;rust.scene_update_quality(b.entry,b.env,overview,resolution)}else{skipped++;expect(a.log,`trial ${trial}`).toEqual([])}
  expect(picture(b),`trial ${trial}`).toBe(picture(a))
  if(a.log.length)prepared++
 }
 expect(skipped).toBeGreaterThan(500);expect(worked).toBeGreaterThan(1500);expect(prepared).toBeGreaterThan(1000)
})
