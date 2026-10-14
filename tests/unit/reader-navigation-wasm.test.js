import {beforeAll,beforeEach,describe,it,expect,vi} from 'vitest'
import {readFileSync} from 'node:fs'
import * as ui from '../../src/wasm/ui/inhouse_read_ui.js'
import {ReaderNavigation} from '../../src/js/readers/reader-navigation.js'
import {LegacyReaderNavigation} from './helpers/reference-reader-navigation.js'
const runtime=vi.hoisted(()=>({ui:null}))
vi.mock('../../src/js/rust-ui.js',()=>({getRustUI:()=>runtime.ui}))
let core
beforeAll(()=>{core=ui.initSync({module:readFileSync('src/wasm/ui/inhouse_read_ui_bg.wasm')});runtime.ui=ui})
const create=engine=>engine==='Rust'?new ReaderNavigation():new LegacyReaderNavigation()
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {resolve,reject,promise}}
const tick=async()=>{for(let i=0;i<8;i++)await Promise.resolve()}
describe.each(['legacy','Rust'])('%s reading navigation',engine=>{
 it('serializes pending actions and preserves their return values',async()=>{
  const nav=create(engine),gate=deferred(),events=[];const generation=nav.generation,current=()=>nav.generation===generation
  expect(nav).toBeInstanceOf(engine==='Rust'?ui.RustReaderNavigation:LegacyReaderNavigation)
  const first=nav.enqueue(async check=>{events.push('first');expect(check()).toBe(true);await gate.promise;events.push('finished');return 42},current)
  const second=nav.enqueue(()=>{events.push('second');return 'next'},current)
  await tick();expect(events).toEqual(['first']);expect(nav.navigating).toBe(true);gate.resolve()
  expect(await first).toBe(42);expect(await second).toBe('next');expect(events).toEqual(['first','finished','second']);expect(nav.navigating).toBe(false);nav.free?.()
 })
 it('lets a new book proceed and prevents an old completion from clearing its active state',async()=>{
  const nav=create(engine),oldGate=deferred(),newGate=deferred(),events=[];const oldGeneration=nav.generation,oldCurrent=()=>nav.generation===oldGeneration
  const old=nav.enqueue(async check=>{events.push('old');await oldGate.promise;expect(check()).toBe(false)},oldCurrent)
  const queued=nav.enqueue(()=>events.push('obsolete'),oldCurrent)
  await tick();nav.cancel();expect(nav.navigating).toBe(false)
  const generation=nav.generation,current=()=>nav.generation===generation
  const next=nav.enqueue(async()=>{events.push('new');await newGate.promise},current)
  await tick();expect(events).toEqual(['old','new']);expect(nav.navigating).toBe(true)
  oldGate.resolve();await Promise.all([old,queued]);expect(nav.navigating).toBe(true);expect(events).toEqual(['old','new'])
  newGate.resolve();await next;expect(nav.navigating).toBe(false);nav.free?.()
 })
 it.each(['throw','reject'])('runs the next action after an action %s',async failure=>{
  const nav=create(engine),generation=nav.generation,current=()=>nav.generation===generation
  const first=nav.enqueue(()=>{if(failure==='throw')throw Error('failed');return Promise.reject(Error('failed'))},current)
  const rejected=expect(first).rejects.toThrow('failed'),next=nav.enqueue(()=>Promise.resolve(7),current)
  await rejected;expect(await next).toBe(7);expect(nav.navigating).toBe(false);nav.free?.()
 })
 it('retains a validator until its consumer releases it and observes cancellation',async()=>{
  const nav=create(engine),generation=nav.generation,current=()=>nav.generation===generation
  let retained;await nav.enqueue(check=>{retained=check},current);expect(retained()).toBe(true);nav.cancel();expect(retained()).toBe(false);nav.free?.()
 })
 it('rejects an obsolete book before invoking its action',async()=>{
  const nav=create(engine),action=vi.fn();expect(await nav.enqueue(action,()=>false)).toBeUndefined();expect(action).not.toHaveBeenCalled();expect(nav.navigating).toBe(false);nav.free?.()
 })
 it('accepts a new queue from inside an action without a borrowed-state trap',async()=>{
  const nav=create(engine),generation=nav.generation;let following
  await nav.enqueue(()=>{nav.cancel();const nextGeneration=nav.generation;following=nav.enqueue(()=>9,()=>nav.generation===nextGeneration)},()=>nav.generation===generation)
  expect(await following).toBe(9);expect(nav.navigating).toBe(false);nav.free?.()
 })
})
it('drops queued work on disposal and reuses memory after 2000 complete queues',async()=>{
 const pending=new ui.RustReaderNavigation(),action=vi.fn(),result=pending.enqueue(action,()=>true);pending.free();await result;expect(action).not.toHaveBeenCalled()
 for(let round=0;round<2;round++){
  const before=core.memory.buffer.byteLength
  for(let i=0;i<1000;i++){const nav=new ui.RustReaderNavigation(),generation=nav.generation;await nav.enqueue(()=>i,()=>nav.generation===generation);nav.free()}
  if(round)expect(core.memory.buffer.byteLength).toBe(before)
 }
})
