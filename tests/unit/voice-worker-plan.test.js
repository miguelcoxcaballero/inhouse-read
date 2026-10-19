// @vitest-environment node
import {expect,it} from 'vitest'
import {VoiceClientPlan} from '../../src/js/readers/neural-voice/client-plan.js'
const create=async()=>{const plan=new VoiceClientPlan(()=>Error('released'));await plan.ready();return plan}
it('admits numeric Worker requests FIFO and ignores duplicate or cancelled work',async()=>{
 const plan=await create()
 try {
  expect(plan.enqueue(10)).toBe(1);expect(plan.enqueue(20)).toBe(0);expect(plan.enqueue(30)).toBe(0)
  expect(plan.enqueue(10)).toBe(3);expect(plan.cancel(20)).toBe(true);expect(plan.enqueue(20)).toBe(3)
  expect(plan.draining).toBe(true)
  expect(plan.take()).toBe(10);expect(plan.workerActive(10)).toBe(true);plan.cancel(10)
  expect(plan.take()).toBe(20);expect(plan.workerActive(20)).toBe(false)
  expect(plan.take()).toBe(30);expect(plan.workerActive(30)).toBe(true);plan.cancel(30)
  expect(plan.take()).toBeNaN();expect(plan.draining).toBe(false)
  expect(plan.enqueue(10)).toBe(1);expect(plan.take()).toBe(10);plan.stopDraining()
  expect(plan.workerActive(10)).toBe(false);expect(plan.draining).toBe(false)
 } finally {plan.dispose()}
})
it('validates request IDs and SameValueZero cancellation without allocating phantom jobs',async()=>{
 const plan=await create()
 try {
  for(const id of ['10',null,undefined,{},Infinity,-Infinity,NaN,.5,Number.MAX_SAFE_INTEGER+1])expect(plan.enqueue(id)).toBe(2)
  expect(plan.take()).toBeNaN();expect(plan.draining).toBe(false)
  expect(plan.enqueue(-0)).toBe(1);expect(plan.enqueue(0)).toBe(3);expect(plan.cancel(0)).toBe(true)
  expect(plan.workerActive(-0)).toBe(false);plan.take();plan.take()
  expect(plan.cancel('missing')).toBe(false)
 } finally {plan.dispose()}
})
it('decodes exact Worker commands and chooses runtime/phonemizer in Rust',async()=>{
 const plan=await create()
 try {
  expect(['init','load','synth','cancel','free'].map(type=>plan.command(type))).toEqual([1,2,3,4,5])
  for(const type of ['',null,undefined,1,{},'Init','initialize','free\0','__proto__'])expect(plan.command(type)).toBe(0)
  for(const config of [{},{runtime:'piper'},{phoneme_type:'hebrew'},{runtime:'supertonic3'},{runtime:'supertonic3',phoneme_type:'hebrew'},{runtime:new String('supertonic3'),phoneme_type:'HEBREW'}]){
   const expected=config.runtime==='supertonic3'?2:config.phoneme_type==='hebrew'?1:0
   expect(plan.classifyRuntime(config)).toBe(expected);expect(plan.runtimeKind).toBe(expected)
  }
  plan.diagnostics=true;expect(plan.diagnostics).toBe(true)
  const old=plan.capture();plan.enqueue(1);plan.invalidate()
  expect(plan.current(old)).toBe(false);expect(plan.take()).toBeNaN();expect(plan.runtimeKind).toBe(0);expect(plan.diagnostics).toBe(true)
 } finally {plan.dispose()}
})
it('drops adopted facade callbacks without stale handles after clear/release',async()=>{
 const plan=await create()
 try {
  const one=plan.next('handle'),two=plan.next('handle');plan.enqueue(one);plan.enqueue(two)
  plan.clearQueue();expect(plan.take()).toBeNaN();expect(plan.workerActive(one)).toBe(false);expect(plan.workerActive(two)).toBe(false)
  const three=plan.next('handle');expect(three).toBe(two+1);plan.enqueue(three);expect(plan.take()).toBe(three)
 } finally {plan.dispose()}
})
