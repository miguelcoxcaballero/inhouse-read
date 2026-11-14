// @vitest-environment node
import {expect,it} from 'vitest'
import {rustShelf as rust} from './helpers/rust-shelf-ready.js'
import {settledQualityWork} from './helpers/reference-scene-quality-settled.js'
import {createSceneEntryFrame,ENTRY_STATE as S,ENTRY_OUTPUT as O} from '../../src/js/scene-entry-frame.js'
import {createSceneMotionFrame} from '../../src/js/scene-motion-frame.js'

// Every settled entry passed through settledQualityWork in every frame (frozen); the scene called
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

// The pose call makes that decision now, from what the arena was told each entry holds (`hold`) and from
// the quality it last told the entry. Over rooms whose models, replacements and plant textures change
// between frames, through zooms and layouts: the same entries are handed to scene_update_quality as the
// frozen host loop handed, and every entry keeps the overview flag and resolution the frozen loop stored.
it('decides in the pose call which settled entries the frozen host loop handed to scene_update_quality',()=>{
 let seed=99;const next=()=>{seed=(seed+0x6D2B79F5)>>>0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}
 const pick=list=>list[Math.floor(next()*list.length)],chance=p=>next()<p
 const scene=new rust.RustScene(600,1200,600,250,false,true,0),roomMotion=new rust.RustRoomMotion(),roomTransition=new rust.RustRoomTransition()
 const key=e=>e.kind?e.key:null,motionFrame=createSceneMotionFrame(rust,key),frame=createSceneEntryFrame(rust)
 const rows=[{left:0,right:600,bottom:300,ceiling:10},{left:0,right:600,bottom:600,top:310},{left:0,right:600,bottom:900,ceiling:610}]
 const room={elements:[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]}
 let ids=1
 const model=()=>chance(.85)?{id:ids++,visible:chance(.9),userData:{overview:pick([false,true,undefined,0,1]),inspectionResolution:pick([0,256,512,1024,2048,undefined,NaN])}}:null
 const fresh=i=>{
  const kind=i%7===3?'plant':i%5===2?'lamp':undefined
  // `told` stands for the live entry (what scene_update_quality stores), the rest is shared with the frozen side.
  return {kind,key:kind?`${kind}:${i}`:`book:${i}`,shelf:i%3,x:30+(i*41)%540,y:kind?255+(i%3)*300:200+(i%3)*300,width:kind?45:150,height:kind?90:200,depth:150,depthInset:0,
   box:Float64Array.of(-14,-90,-7,14,110,7),bits:0,row:-1,stale:true,model:model(),insertion:null,trashDrop:null,qualityReplacement:false,replacementReady:false,plantQuality:null,
   overview:false,inspectionResolution:0,told:{overview:false,inspectionResolution:0}}
 }
 let entries=Array.from({length:14},(_,i)=>fresh(i)),applied=0,worked=0,needed=0,skipped=0,qualities=new Set(),serial=100,view=null
 frame.bind(entries,true)
 try{
  for(let tick=0;tick<1500;tick++){
   if(tick%97===50){
    // A layout: some entries stay in another order, some go, some arrive.
    entries=[...entries.filter(()=>chance(.8)).sort(()=>next()-.5),...Array.from({length:Math.floor(next()*4)},()=>fresh(serial++))]
    frame.bind(entries,chance(.5));for(const e of entries)e.stale=true
   }
   for(const e of entries){
    if(chance(.02))e.model=model()
    if(e.model&&chance(.02))Object.assign(e.model.userData,{overview:pick([false,true,undefined]),inspectionResolution:pick([0,256,512,1024,2048,undefined])})
    if(chance(.01))e.qualityReplacement=!e.qualityReplacement
    if(chance(.01))e.plantQuality=e.plantQuality?null:{ready:chance(.5)}
    if(chance(.02))e.bits=pick([0,0,1,2,8])
   }
   // The view rests for a while between changes, as a room does.
   if(tick%12===0){
    view=[pick([1,1,1.6,2.5,4]),pick([1,1,2,3.5]),chance(.15),pick([1,2,2.625]),pick([0,0,150]),pick([.3,1,1])]
    scene.setMode(chance(.7),false,tick*16,0);scene.sizeViewport(1400,1400,2,new Float64Array(4))
    const k=view[5];room.elements=[k,0,0,0,0,k,0,0,0,0,k,0,0,0,0,1]
   }
   scene.setInspection(view[1],0,0,view[2])
   scene.beginEntries(tick*16,false,view[0],new Float64Array([0,0,0,1]),view[3],600,view[4],44)
   motionFrame.prepare(entries,rows,600,1000)
   frame.refresh()
   entries.forEach((e,index)=>{
    const at=index*S,state=frame.state,kind=e.kind==='plant'?1:e.kind==='lamp'?2:0
    if(e.stale){e.stale=false;state[at]=kind;state[at+1]=0;state[at+23]=e.x;state[at+24]=e.y;state[at+25]=e.width;state[at+26]=e.height;state[at+27]=e.depth;state[at+28]=e.depthInset;state.set(e.box,at+50)}
    state[at+2]=e.bits;state[at+3]=0;state[at+4]=0
    state[at+49]=(e.model?4:0)|(e.told.overview?8:0)
   })
   frame.hold(entries)
   frame.poses(motionFrame.native,scene,roomMotion,roomTransition,tick*16,false,room)
   entries.forEach((e,index)=>{
    const live=frame.output,at=index*O,work=Boolean(frame.state[index*S+70]&8)
    if(live[at+66]!==1){expect(work,`tick ${tick} entry ${index}`).toBe(false);return}
    const overview=live[at+67]===1,resolution=live[at+68]
    applied++;qualities.add(`${overview}:${resolution}`)
    // The entry is also handed over when its two numbers are not the ones it holds, to store them (the
    // frozen loop stored them in every frame; the call does nothing else then, as the test above shows).
    const untold=e.told.overview!==overview||!Object.is(e.told.inspectionResolution,resolution)
    const frozen=settledQualityWork(e,overview,resolution)
    if(frozen)needed++
    expect(work,`tick ${tick} entry ${index}`).toBe(frozen||untold)
    if(work){
     worked++;e.told.overview=overview;e.told.inspectionResolution=resolution
     // Its model reaches that quality sooner or later (a replacement, a plant's texture).
     if(e.model&&chance(.5))Object.assign(e.model.userData,{overview,inspectionResolution:resolution})
    }else skipped++
    expect([e.told.overview,e.told.inspectionResolution],`tick ${tick} entry ${index}`).toEqual([e.overview,e.inspectionResolution])
   })
  }
  expect(applied).toBeGreaterThan(3000);expect(worked).toBeGreaterThan(1000);expect(needed).toBeGreaterThan(1000);expect(skipped).toBeGreaterThan(1500);expect(qualities.size).toBeGreaterThan(2)
 }finally{frame.free();motionFrame.free();roomMotion.free();roomTransition.free();scene.free()}
})
