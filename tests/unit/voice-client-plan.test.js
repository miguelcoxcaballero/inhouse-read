// @vitest-environment node
import {expect,it} from 'vitest'
import {VoiceClientPlan} from '../../src/js/readers/neural-voice/client-plan.js'
import {rustVoiceCore as core} from './helpers/rust-voice-ready.js'
const plan=()=>new VoiceClientPlan(()=>new Error('released'))
it('keeps preparation reuse, runtime families and disposal generations in the voice core',async()=>{
 const state=plan(),before=state.capture();expect(state.pointer).toBe(0)
 state.beginPreparation('es-voice');expect(state.preparing('es-voice')).toBe(true)
 await state.ready();expect(state.current(before)).toBe(true);expect(state.preparing('es-voice')).toBe(true)
 state.model(2,'es-voice');expect(state.model(8,'es-voice')).toBe(false)
 state.finishPreparation();expect(state.model(8,'es-voice')).toBe(true)
 expect(state.model(1,'other-piper')).toBe(false);expect(state.model(1,'supertonic3')).toBe(true)
 const call=state.next('call'),job=state.next('job');expect(job).toBe(call+1)
 expect(state.active(job,before)).toBe(true);expect(state.cancel(job)).toBe(true);expect(state.cancel(job)).toBe(false)
 state.dispose();expect(state.pointer).toBe(0);expect(state.current(before)).toBe(false)
 await state.ready();expect(state.current(before)).toBe(false);expect(state.model(0,'es-voice')).toBe(false)
 expect(state.next('call')).toBe(job+1);state.dispose()
})
it('retains exact dispatch, passive diagnostics and one-shot settlement across random receipts',async()=>{
 const state=plan();await state.ready();const calls=new Set(),jobs=new Set()
 const expected=m=>{
  if(m.type==='stage')return [1,2,3].includes(m.domain)&&Number.isInteger(m.stage)&&m.stage>=1&&m.stage<=7&&Number.isSafeInteger(m.id)&&Number.isInteger(m.part)&&m.part>=0?7:0
  if(calls.delete(m.id))return m.type==='error'?2:1
  if(!jobs.has(m.id))return 0
  if(m.type==='plan')return 3;if(m.type==='chunk')return 4
  if(m.type==='end'){jobs.delete(m.id);return 5}if(m.type==='error'){jobs.delete(m.id);return 6}return 0
 }
 let seed=987123
 for(let i=0;i<4000;i++){
  seed=(Math.imul(seed,1664525)+1013904223)>>>0
  if(i%7===0){const kind=i%2?'call':'job',id=state.next(kind);(kind==='call'?calls:jobs).add(id)}
  const message={type:['ready','loaded','plan','chunk','end','error','stage','unknown'][seed%8],id:seed%9===0?String(seed%600):seed%600,domain:seed%5,stage:seed%10,part:seed%3-1}
  expect(state.message(message)).toBe(expected(message))
 }
 for(const domain of [1,2,3,'1',null,NaN])for(const stage of [1,7,0,8,1.2,'1',Infinity])for(const id of [0,-1,Number.MAX_SAFE_INTEGER,Number.MAX_SAFE_INTEGER+1,'1',NaN]){
  const m={type:'stage',domain,stage,id,part:0};expect(state.message(m)).toBe(expected(m))
 }
 state.dispose()
})
it('bounds memory after repeated preparation, jobs, resets and native frees',async()=>{
 const run=async()=>{
  for(let n=0;n<200;n++){
   const state=plan();await state.ready();state.beginPreparation('voice-'+n);state.model(2,'voice-'+n);state.finishPreparation()
   const token=state.capture()
   for(let i=0;i<32;i++){const id=state.next('job');expect(state.active(id,token)).toBe(true);state.cancel(id)}
   state.dispose();expect(state.pointer).toBe(0)
  }
 }
 await run();const capacity=core.memory.buffer.byteLength;await run();expect(core.memory.buffer.byteLength).toBe(capacity)
})
