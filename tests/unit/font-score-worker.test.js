// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { glyphMask, nearEdgeMap, scoreFontMask as originalScore } from './helpers/reference-cover-appearance.js'

const drain=task=>{let step=task.next();while(!step.done)step=task.next();return step.value}
function inputs(seed=1) {
  const width=64,height=80,rows=65,gray=Uint8Array.from({length:width*height},(_,i)=>(i*31+seed*23)%256)
  const near=nearEdgeMap(Float32Array.from({length:gray.length},(_,i)=>(i*17+seed*5)%255),width)
  const raw=new Uint8ClampedArray(24*20*4)
  for(let y=3;y<17;y++)for(let x=3;x<19;x++)if(x<8||y<7||((x+y)%4===0))raw[(y*24+x)*4+3]=255
  const mask=glyphMask(raw,24,20,width)
  return {gray,near,width,height,rows,mask}
}
// A Worker is a fresh realm: the page's early compilation promises do not exist there.
const workerRealm=()=>{vi.resetModules();delete globalThis.__inhouseRustReady;delete globalThis.__inhouseDecorReady}
let scope
beforeEach(async()=>{
  workerRealm();scope={postMessage:vi.fn()};vi.stubGlobal('self',scope)
  const {loadRustCore}=await import('../../src/js/rust-core.js')
  expect(await loadRustCore({bytes:readFileSync(new URL('../../src/wasm/inhouse_read_core.wasm',import.meta.url))})).not.toBeNull()
  await import('../../src/js/font-score-worker.js')
})
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks()})
const send=async data=>{await scope.onmessage({data:structuredClone(data)});return scope.postMessage.mock.calls.at(-1)?.[0]}

describe('real module Worker scorer protocol',()=>{
  it('scores typed cloned inputs with the exact original generator result',async()=>{
    const {mask,...context}=inputs()
    expect(await send({type:'begin',job:1,request:1,...context})).toEqual({type:'begin',job:1,request:1,accepted:true})
    const value=await send({type:'score',job:1,request:2,mask})
    expect(value).toEqual({type:'score',job:1,request:2,score:drain(originalScore(context.gray,context.near,context.width,context.height,context.rows,mask))})
    expect(Number.isFinite(value.score)).toBe(true)
  })
  it('releases previous image state at end and cannot score a closed job',async()=>{
    const {mask,...context}=inputs();await send({type:'begin',job:1,request:1,...context})
    await scope.onmessage({data:{type:'end',job:1}})
    expect(await send({type:'score',job:1,request:2,mask})).toEqual({type:'error',job:1,request:2})
  })
  it('uses only the new job image and rejects stale job IDs',async()=>{
    const first=inputs(1),second=inputs(7)
    await send({type:'begin',job:1,request:1,...first});await send({type:'begin',job:2,request:2,...second})
    expect(await send({type:'score',job:1,request:3,mask:first.mask})).toEqual({type:'error',job:1,request:3})
    const value=await send({type:'score',job:2,request:4,mask:second.mask})
    expect(value.score).toBe(drain(originalScore(second.gray,second.near,second.width,second.height,second.rows,second.mask)))
  })
  it('rejects invalid typed or dimensional inputs instead of coercing their pixels',async()=>{
    const {mask,...context}=inputs()
    for(const bad of [{gray:Array.from(context.gray)},{near:Float64Array.from(context.near)},{width:1.5},{gray:new Uint8Array(1)},{rows:81}]) {
      expect(await send({type:'begin',job:4,request:8,...context,...bad})).toEqual({type:'error',job:4,request:8})
    }
    expect(await send({type:'score',job:4,request:9,mask})).toEqual({type:'error',job:4,request:9})
  })
  it('serializes begin, score and end sent before initialization finishes',async()=>{
    const {mask,...context}=inputs(3)
    const first=scope.onmessage({data:{type:'begin',job:8,request:1,...context}})
    const second=scope.onmessage({data:{type:'score',job:8,request:2,mask}})
    const third=scope.onmessage({data:{type:'end',job:8}})
    await Promise.all([first,second,third])
    expect(scope.postMessage.mock.calls.map(call=>call[0])).toEqual([
      {type:'begin',job:8,request:1,accepted:true},
      {type:'score',job:8,request:2,score:drain(originalScore(context.gray,context.near,context.width,context.height,context.rows,mask))}
    ])
    expect(await send({type:'score',job:8,request:3,mask})).toEqual({type:'error',job:8,request:3})
  })
  it('keeps the original scorer when the compiled module cannot be loaded',async()=>{
    workerRealm();vi.stubGlobal('fetch',vi.fn(async()=>{throw new Error('Offline first visit')}))
    await import('../../src/js/font-score-worker.js')
    const {mask,...context}=inputs(7)
    await send({type:'begin',job:9,request:1,...context})
    const value=await send({type:'score',job:9,request:2,mask})
    expect(value.score).toBe(drain(originalScore(context.gray,context.near,context.width,context.height,context.rows,mask)))
    expect(fetch).toHaveBeenCalledOnce()
  })
  it('accepts, scores and closes a job without waiting for a pending wasm fetch',async()=>{
    workerRealm()
    let finishFetch
    vi.stubGlobal('fetch',vi.fn(()=>new Promise(resolve=>{finishFetch=resolve})))
    await import('../../src/js/font-score-worker.js')
    const {mask,...context}=inputs(13)
    // The fetch remains pending through all three operations. Awaiting it in
    // begin would hang this test and spend the real client's startup timeout.
    expect(await send({type:'begin',job:11,request:1,...context})).toEqual({type:'begin',job:11,request:1,accepted:true})
    expect((await send({type:'score',job:11,request:2,mask})).score).toBe(drain(originalScore(context.gray,context.near,context.width,context.height,context.rows,mask)))
    await scope.onmessage({data:{type:'end',job:11}})
    finishFetch(new Response(readFileSync(new URL('../../src/wasm/inhouse_read_core.wasm',import.meta.url)),{headers:{'content-type':'application/wasm'}}))
    const {loadRustCore}=await import('../../src/js/rust-core.js')
    expect(await loadRustCore()).not.toBeNull()
    expect(await send({type:'score',job:11,request:3,mask})).toEqual({type:'error',job:11,request:3})
    const second=inputs(77)
    await send({type:'begin',job:12,request:4,...second})
    expect((await send({type:'score',job:12,request:5,mask:second.mask})).score).toBe(drain(originalScore(second.gray,second.near,second.width,second.height,second.rows,second.mask)))
  })
})
