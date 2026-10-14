import {afterEach,beforeAll,beforeEach,describe,it,expect,vi} from 'vitest'
import {readFileSync} from 'node:fs'
import * as ui from '../../src/wasm/ui/inhouse_read_ui.js'
import {createReadingProgressQueue as shippedQueue} from '../../src/js/reading-progress-queue.js'
import {createLegacyReadingProgressQueue} from './helpers/reference-reading-progress-queue.js'
const runtime=vi.hoisted(()=>({ui:null}))
vi.mock('../../src/js/rust-ui.js',()=>({getRustUI:()=>runtime.ui}))
const handles=[];let core
const nativeRuntime={RustReadingProgressQueue:class extends ui.RustReadingProgressQueue{constructor(...args){super(...args);handles.push(this)}}}
beforeAll(()=>{core=ui.initSync({module:readFileSync('src/wasm/ui/inhouse_read_ui_bg.wasm')})})
afterEach(()=>{for(const handle of handles.splice(0))handle.free()})
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {resolve,reject,promise}}
const tick=async()=>{for(let i=0;i<12;i++)await Promise.resolve()}
// 'legacy' is the frozen JavaScript reference; 'Rust' is the shipped queue.
let createReadingProgressQueue
describe.each(['legacy','Rust'])('%s persistence queue boundaries',engine=>{
 beforeEach(()=>{runtime.ui=engine==='Rust'?nativeRuntime:null;createReadingProgressQueue=engine==='Rust'?shippedQueue:createLegacyReadingProgressQueue})
 it('uses original Map key identity for objects, NaN, symbols and zero',async()=>{
  const library={updateProgress:vi.fn(async(id,fraction)=>({id,fraction}))},queue=createReadingProgressQueue(library)
  const keys=[{}, {}, Symbol('a'), Symbol('a'), NaN, -0, null, undefined, 'book']
  const tasks=keys.map(id=>queue.updateProgress(id,1,{}))
  expect(queue.updateProgress(NaN,2,{})).toBe(tasks[4]);expect(queue.updateProgress(0,3,{})).toBe(tasks[5])
  const records=await Promise.all(tasks);expect(library.updateProgress).toHaveBeenCalledTimes(keys.length)
  records.forEach((record,index)=>expect(Object.is(record.id,keys[index])).toBe(true))
  expect(records[4].fraction).toBe(2);expect(records[5].fraction).toBe(3)
 })
 it('clones enumerable fields once, retaining nested references and own __proto__',async()=>{
  const nested={},fields=Object.defineProperty({nested},'__proto__',{value:nested,enumerable:true}),read=vi.fn(()=>42)
  Object.defineProperty(fields,'getter',{get:read,enumerable:true})
  const library={patch:vi.fn(async(id,value)=>value)},queue=createReadingProgressQueue(library),promise=queue.patch('book',fields)
  fields.nested=null;const record=await promise
  expect(read).toHaveBeenCalledOnce();expect(record.nested).toBe(nested);expect(Object.hasOwn(record,'__proto__')).toBe(true)
  expect(Object.getPrototypeOf(record)).toBe(Object.prototype);expect(record.__proto__).toBe(nested);expect(record.getter).toBe(42)
 })
 it.each(['storage throw','storage reject','notification throw','notification reject'])('preserves %s identity and continues',async mode=>{
  const failure=new Error(mode),gate=deferred();let first=true
  const fail=()=>{if(mode.endsWith('throw'))throw failure;return Promise.reject(failure)}
  const library={updateProgress:vi.fn(()=>{if(mode.startsWith('storage')&&first){first=false;return fail()}return {ok:true}})}
  const queue=createReadingProgressQueue(library,{onSaved:()=>{if(mode.startsWith('notification')&&first){first=false;return fail()}return gate.promise}})
  const failed=queue.updateProgress('book',1,{}),observed=expect(failed).rejects.toBe(failure)
  await observed;const final=queue.updateProgress('book',2,{});gate.resolve();expect(await final).toEqual({ok:true});expect(queue.get('book')).toBeUndefined()
 })
 it('allows storage callbacks to enqueue a settings barrier without borrow errors',async()=>{
  let queue,next,once=true;const events=[]
  const library={updateProgress:async()=>{events.push('position');if(once){once=false;next=queue.patch('book',{theme:'night'})}return 1},patch:async()=>{events.push('settings');return 2}}
  queue=createReadingProgressQueue(library);expect(await queue.updateProgress('book',1,{})).toBe(1);expect(await next).toBe(2);expect(events).toEqual(['position','settings'])
 })
})
it('has no JavaScript queue: a write without the module rejects clearly and writes nothing',async()=>{
 runtime.ui=null;const library={updateProgress:vi.fn(async()=>({})),patch:vi.fn(async()=>({}))},queue=shippedQueue(library)
 await expect(queue.updateProgress('a',1,{})).rejects.toThrow('módulo Rust');await expect(queue.patch('a',{theme:'x'})).rejects.toThrow('módulo Rust')
 expect(queue.get('a')).toBeUndefined();expect(library.updateProgress).not.toHaveBeenCalled();expect(library.patch).not.toHaveBeenCalled();expect(handles).toHaveLength(0)
 runtime.ui={RustReadingProgressQueue:class{constructor(){throw Error('Unavailable')}}}
 await expect(queue.updateProgress('a',1,{})).rejects.toThrow('Unavailable')
})
it('builds one native queue on the first write and serialises every book through it',async()=>{
 runtime.ui=nativeRuntime;const gate=deferred(),events=[];let first=true
 const queue=shippedQueue({updateProgress:async(id,fraction)=>{events.push([id,fraction]);if(first){first=false;await gate.promise}return fraction}})
 expect(handles).toHaveLength(0);expect(queue.get('a')).toBeUndefined()
 const old=queue.updateProgress('a',1,{});await tick()
 const next=queue.updateProgress('a',2,{});expect(await queue.updateProgress('b',3,{})).toBe(3)
 expect(handles).toHaveLength(1);expect(events).toEqual([['a',1],['b',3]])
 gate.resolve();await old;await next;const native=handles[0],update=vi.spyOn(native,'updateProgress')
 await queue.updateProgress('a',4,{});expect(update).toHaveBeenCalledExactlyOnceWith('a',4,{})
 expect(events).toEqual([['a',1],['b',3],['a',2],['a',4]])
})
it('retains all pending saves after releasing the host handle',async()=>{
 const gate=deferred(),events=[],queue=new ui.RustReadingProgressQueue(async(id,f)=>{events.push(f);await gate.promise;return f},()=>{},()=>{})
 const first=queue.updateProgress('book',1,{});await tick();const second=queue.updateProgress('book',2,{})
 queue.free();gate.resolve();expect(await first).toBe(1);expect(await second).toBe(2);expect(events).toEqual([1,2])
})
it('reuses drained book slots and bounds WASM memory over thousands of identities',async()=>{
 for(let round=0;round<2;round++){
  const before=core.memory.buffer.byteLength,queue=new ui.RustReadingProgressQueue((id,f)=>f,()=>{},()=>{})
  for(let i=0;i<2000;i++)expect(await queue.updateProgress('book'+i,i,{})).toBe(i)
  queue.free();if(round)expect(core.memory.buffer.byteLength).toBe(before)
 }
})
