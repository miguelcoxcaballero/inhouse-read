import {beforeAll,beforeEach,afterEach,it,expect,vi} from 'vitest'
import * as rustShelf from '../../src/wasm/shelf/inhouse_read_shelf.js'
import {createShelfRefreshQueue} from '../../src/js/shelf-refresh-queue.js'
// The JavaScript queue the app had before the shelf module's became the only one, frozen.
import {createLegacyShelfRefreshQueue} from './helpers/reference-shelf-refresh-queue.js'

// The loader the queue asks for its module: absent until `arrive()`, as on a page whose module is still compiling.
const runtime=vi.hoisted(()=>({shelf:null,waiting:[],made:0}))
vi.mock('../../src/js/rust-shelf.js',()=>({
 getRustShelf:()=>runtime.shelf,
 whenRustShelf:use=>{if(runtime.shelf)use(runtime.shelf);else runtime.waiting.push(use)}
}))
let native,baseline=0
const arrive=()=>{runtime.shelf=native;for(const use of runtime.waiting.splice(0))use(native)}
const tick=async()=>{for(let i=0;i<8;i++)await Promise.resolve()}
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}}
const queues=[]
const create=options=>{const q=createShelfRefreshQueue(options);queues.push(q);return q}
beforeAll(()=>{
 baseline=rustShelf.shelf_live_handles()
 native={...rustShelf,RustShelfRefreshQueue:class extends rustShelf.RustShelfRefreshQueue{constructor(...args){super(...args);runtime.made++}}}
})
beforeEach(()=>{runtime.shelf=null;runtime.waiting.length=0;runtime.made=0;vi.useFakeTimers()})
afterEach(async()=>{for(const q of queues.splice(0))q.dispose();await tick();expect(rustShelf.shelf_live_handles()).toBe(baseline);vi.useRealTimers();vi.restoreAllMocks()})

// A deterministic script generator.
function random(seed){let s=seed>>>0;return()=>{s=(Math.imul(s,1664525)+1013904223)>>>0;return s/4294967296}}

/** Runs one script against a queue and returns everything observable: when each read started and with which
 * options, and when and how each request settled. `module` says at which step the shelf module arrives
 * (-1: it was in before the page asked anything; Infinity: the frozen queue, which never had one). */
async function play(make,steps,module){
 const trace=[],reads=[],start=Date.now()
 const at=()=>Date.now()-start
 const perform=options=>{
  const read=deferred(),id=reads.length;reads.push(read)
  trace.push(`read ${id} ${JSON.stringify(options)} @${at()}`)
  return read.promise
 }
 if(module===-1)arrive()
 const queue=make({perform})
 let asked=0
 for(let index=0;index<steps.length;index++){
  if(index===module)arrive()
  const [kind,value]=steps[index]
  if(kind==='ask'){
   const id=asked++
   queue.request({immediate:value}).then(result=>trace.push(`yes ${id} ${String(result)} @${at()}`),error=>trace.push(`no ${id} ${String(error)} @${at()}`))
  }else if(kind==='wait')await vi.advanceTimersByTimeAsync(value)
  else if(kind==='settle'){const read=reads.find(read=>!read.done);if(read){read.done=true;value?read.reject(`error ${reads.indexOf(read)}`):read.resolve(`value ${reads.indexOf(read)}`)}}
  else if(kind==='dispose')queue.dispose()
  await tick()
  trace.push(`step ${index}`)
 }
 // Let every remaining deadline and read finish, so a held request cannot hide.
 for(let round=0;round<6;round++){
  await vi.advanceTimersByTimeAsync(200)
  for(const read of reads)if(!read.done){read.done=true;read.resolve(`value ${reads.indexOf(read)}`)}
  await tick()
 }
 trace.push(`end reads=${reads.length} asked=${asked}`)
 queue.dispose();await tick()
 return trace
}

const anyStep=next=>{
 const pick=next()
 if(pick<.3)return ['ask',false]
 if(pick<.5)return ['ask',true]
 if(pick<.75)return ['wait',[0,1,20,40,79,80,81,160][Math.floor(next()*8)]]
 if(pick<.97)return ['settle',next()<.2]
 return ['dispose']
}

it('with the module in from the first request, 400 random scripts match the frozen JavaScript queue step by step',async()=>{
 let reads=0,requests=0
 for(let seed=1;seed<=400;seed++){
  const next=random(seed),steps=Array.from({length:6+Math.floor(next()*30)},()=>anyStep(next))
  const expected=await play(createLegacyShelfRefreshQueue,steps,Infinity)
  runtime.shelf=null;const actual=await play(create,steps,-1)
  expect(actual,`seed ${seed}`).toEqual(expected)
  const end=expected.at(-1).match(/reads=(\d+) asked=(\d+)/);reads+=Number(end[1]);requests+=Number(end[2])
 }
 // The scripts really exercised the queue.
 expect(reads).toBeGreaterThan(800);expect(requests).toBeGreaterThan(2500);expect(runtime.made).toBeGreaterThan(300)
})

it('a first read that outlives the module\'s arrival, the way the app\'s does, matches the frozen queue in 400 random scripts',async()=>{
 // The page's first request is urgent and its read awaits the module itself, so the read is still running
 // when the module arrives: everything asked meanwhile is taken over with its original deadline.
 let taken=0
 for(let seed=1;seed<=400;seed++){
  const next=random(seed*7919),before=Array.from({length:Math.floor(next()*10)},()=>{const pick=next();return pick<.45?['ask',false]:pick<.65?['ask',true]:['wait',[0,1,20,40,79,80,81,160][Math.floor(next()*8)]]})
  const after=Array.from({length:4+Math.floor(next()*24)},()=>anyStep(next)),steps=[['ask',true],...before,...after]
  const expected=await play(createLegacyShelfRefreshQueue,steps,Infinity)
  runtime.shelf=null;runtime.waiting.length=0;const actual=await play(create,steps,1+before.length)
  expect(actual,`seed ${seed}`).toEqual(expected)
  taken+=before.filter(step=>step[0]==='ask').length
 }
 expect(taken).toBeGreaterThan(800);expect(runtime.made).toBe(400)
})

it('urgent requests before the module are read at once, one read at a time, exactly as the frozen queue reads them',async()=>{
 for(let seed=1;seed<=200;seed++){
  const next=random(seed*104729),before=Array.from({length:2+Math.floor(next()*14)},()=>{const pick=next();return pick<.5?['ask',true]:pick<.7?['wait',[0,1,40,80,160][Math.floor(next()*5)]]:['settle',next()<.25]})
  const after=Array.from({length:Math.floor(next()*16)},()=>anyStep(next)),steps=[...before,...after]
  const expected=await play(createLegacyShelfRefreshQueue,steps,Infinity)
  runtime.shelf=null;runtime.waiting.length=0;const actual=await play(create,steps,before.length)
  expect(actual,`seed ${seed}`).toEqual(expected)
 }
})

it('keeps the exact two-microtask read and finish order, before and after the module',async()=>{
 const traces=[]
 for(const mode of ['frozen','before','after']){
  runtime.shelf=null;runtime.waiting.length=0;if(mode==='after')arrive()
  const trace=[],q=(mode==='frozen'?createLegacyShelfRefreshQueue:create)({perform:()=>{trace.push('perform');return 7}})
  const promise=q.request({immediate:true});promise.then(v=>trace.push('value:'+v));trace.push('requested')
  for(let i=0;i<8;i++){await Promise.resolve();trace.push('turn:'+i)}
  await promise;traces.push(trace);q.dispose()
 }
 expect(traces[1]).toEqual(traces[0]);expect(traces[2]).toEqual(traces[0]);expect(runtime.made).toBe(1)
})

it('holds a background request made before the module until the module is in, then reads it at its original deadline',async()=>{
 // The one difference from the frozen queue, which read such a request by itself after its 80 ms. The app's
 // read cannot do anything without the module (it awaits it), so the read starts when the module arrives.
 const perform=vi.fn(()=>7),q=create({perform});const early=q.request(),late=q.request()
 await vi.advanceTimersByTimeAsync(300);expect(perform).not.toHaveBeenCalled();expect(runtime.made).toBe(0)
 arrive();await tick();expect(perform).toHaveBeenCalledOnce();expect(perform).toHaveBeenCalledWith({immediate:false})
 await expect(early).resolves.toBe(7);await expect(late).resolves.toBe(7);expect(runtime.made).toBe(1)
 // One that has waited only part of its deadline waits the rest.
 runtime.shelf=null;const second=vi.fn(()=>8),other=create({perform:second}),asked=other.request()
 await vi.advanceTimersByTimeAsync(30);arrive();await tick();expect(second).not.toHaveBeenCalled()
 await vi.advanceTimersByTimeAsync(49);expect(second).not.toHaveBeenCalled()
 await vi.advanceTimersByTimeAsync(1);await expect(asked).resolves.toBe(8);expect(second).toHaveBeenCalledOnce()
})

it('disposed before the module arrives: waiting requests resolve empty, a running read keeps its result, the module makes nothing',async()=>{
 const first=deferred(),perform=vi.fn(()=>first.promise),q=create({perform}),a=q.request({immediate:true});await tick()
 const b=q.request({immediate:true}),c=q.request();q.dispose();q.dispose()
 await expect(b).resolves.toBeUndefined();await expect(c).resolves.toBeUndefined();await expect(q.request({immediate:true})).resolves.toBeUndefined()
 arrive();first.resolve(8);await expect(a).resolves.toBe(8);await tick();expect(perform).toHaveBeenCalledOnce();expect(runtime.made).toBe(0)
})

it('returns the same fresh record identity to each caller without serializing it',async()=>{
 arrive();const value={cover:new Blob(['cover']),file:new Blob(['book']),locator:{page:3}},perform=vi.fn(()=>value),q=create({perform}),requests=Array.from({length:50},()=>q.request());await vi.advanceTimersByTimeAsync(80);for(const result of await Promise.all(requests))expect(result).toBe(value);expect(perform).toHaveBeenCalledOnce()
})
it.each([undefined,null,false,0,''])('keeps rejection identity for %s and recovers afterward, before and after the module',async reason=>{
 for(const early of [true,false]){
  runtime.shelf=null;if(!early)arrive()
  const perform=vi.fn().mockImplementationOnce(()=>Promise.reject(reason)).mockReturnValue(4),q=create({perform});await expect(q.request({immediate:true})).rejects.toBe(reason);await expect(q.request({immediate:true})).resolves.toBe(4)
 }
})
it('freeing the host preserves the result of an active read and cancels its trailing request',async()=>{
 arrive();const first=deferred(),perform=vi.fn(()=>first.promise),q=create({perform}),a=q.request({immediate:true});await tick();const b=q.request({immediate:true});q.dispose();q.dispose();await expect(b).resolves.toBeUndefined();await expect(q.request({immediate:true})).resolves.toBeUndefined();first.resolve(8);await expect(a).resolves.toBe(8);await tick();expect(perform).toHaveBeenCalledOnce();expect(rustShelf.shelf_live_handles()).toBe(baseline)
})
it('can enqueue synchronously from perform without overlapping or borrowing live state, before and after the module',async()=>{
 for(const early of [true,false]){
  runtime.shelf=null;if(!early)arrive()
  let trailing;let q;const perform=vi.fn(()=>{if(perform.mock.calls.length===1){trailing=q.request({immediate:true});return 1}return 2});q=create({perform});await expect(q.request({immediate:true})).resolves.toBe(1);await expect(trailing).resolves.toBe(2);expect(perform).toHaveBeenCalledTimes(2)
 }
})
it('hands injected timers and opaque timer IDs to the module\'s queue',async()=>{
 arrive();const id=Symbol('timer');let fire;const setTimer=vi.fn(callback=>{fire=callback;return id}),clearTimer=vi.fn(),q=create({perform:()=>6,setTimer,clearTimer});const p=q.request();await expect(q.request({immediate:true})).resolves.toBe(6);await expect(p).resolves.toBe(6);expect(clearTimer).toHaveBeenCalledWith(id);expect(setTimer).toHaveBeenCalledWith(expect.any(Function),80);expect(runtime.made).toBe(1);expect(typeof fire).toBe('function')
})
it('releases every module callback after repeated complete queues, taken over or not',async()=>{
 for(let i=0;i<100;i++){
  runtime.shelf=null;runtime.waiting.length=0;if(i%2)arrive()
  const q=create({perform:()=>i}),a=q.request({immediate:true}),b=q.request({immediate:true}),c=q.request()
  if(!(i%2))arrive()
  await expect(a).resolves.toBe(i);await expect(b).resolves.toBe(i);await vi.advanceTimersByTimeAsync(80);await expect(c).resolves.toBe(i)
  q.dispose();await tick();expect(rustShelf.shelf_live_handles()).toBe(baseline)
 }
 expect(runtime.made).toBe(100)
})
it('preserves argument validation before doing any work',()=>{
 arrive();expect(()=>create()).toThrow(new TypeError('Shelf refresh needs a perform callback'));const perform=vi.fn(),q=create({perform});expect(()=>q.request(null)).toThrow(TypeError);expect(perform).not.toHaveBeenCalled();expect(runtime.made).toBe(0)
})
