// @vitest-environment node
import {expect,it} from 'vitest'
import {PhonemizerPlan} from './helpers/raw-phonemizer-plan.js'

it('matches the original rebuild/retry policy across thresholds and long workloads',async()=>{
 for(const limit of [0,-1,.5,1,2,40,1000,Infinity,NaN]){
  const plan=await PhonemizerPlan.create(limit);let calls=0
  try {
   expect(plan.accept(plan.build())).toBe(true)
   for(let job=0;job<800;job++){
    const rebuild=calls>=limit
    expect(plan.begin()).toBe(Number(rebuild))
    if(rebuild){calls=0;expect(plan.accept(plan.build())).toBe(true)}
    expect(plan.attempt()).toBe(true);calls++
    if(job%7===4){
     expect(plan.retry()).toBe(true);calls=0;expect(plan.accept(plan.build())).toBe(true)
     expect(plan.attempt()).toBe(true);calls++;expect(plan.retry()).toBe(false)
    }
   }
  }finally{plan.close()}
 }
})

it('retains downloaded bytes across fresh filesystems and rejects stale builds',async()=>{
 const plan=await PhonemizerPlan.create(40)
 const first=plan.build();expect(plan.accept(first)).toBe(true)
 for(let id=0;id<19;id++){expect(plan.dictionary(id)).toBe(1);expect(plan.dictionary(id,1)).toBe(2);expect(plan.dictionary(id,2)).toBe(0)}
 const next=plan.build();expect(plan.current(first)).toBe(false);expect(plan.accept(first)).toBe(false)
 expect(plan.accept(next)).toBe(true)
 for(let id=0;id<19;id++)expect(plan.dictionary(id)).toBe(2)
 plan.close();expect(plan.current(next)).toBe(false);expect(plan.accept(next)).toBe(false)
 expect(plan.begin()).toBe(-1);expect(plan.retry()).toBe(false);expect(plan.dictionary(0)).toBe(-1)
 plan.close()
})

it('frees native allocations and keeps capacity stable across repeated lifetimes',async()=>{
 const warm=await PhonemizerPlan.create(40),core=warm.core;warm.close()
 let plateau
 for(let run=0;run<600;run++){
  const plan=await PhonemizerPlan.create(40)
  plan.accept(plan.build())
  for(let id=0;id<19;id++){plan.dictionary(id,1);plan.dictionary(id,2)}
  for(let job=0;job<100;job++){if(plan.begin())plan.accept(plan.build());plan.attempt()}
  plan.close()
  if(run===10)plateau=core.memory.buffer.byteLength
 }
 expect(core.memory.buffer.byteLength).toBe(plateau)
})
