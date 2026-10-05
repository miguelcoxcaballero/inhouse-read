// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
let scope
beforeEach(async()=>{
  vi.resetModules();scope={postMessage:vi.fn()};vi.stubGlobal('self',scope)
  await import('../../src/js/font-score-worker.js')
})
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks()})
const send=data=>{scope.onmessage({data:structuredClone(data)});return scope.postMessage.mock.calls.at(-1)?.[0]}

describe('real module Worker scorer protocol',()=>{
  it('scores typed cloned inputs with the exact original generator result',()=>{
    const {mask,...context}=inputs()
    expect(send({type:'begin',job:1,request:1,...context})).toEqual({type:'begin',job:1,request:1,accepted:true})
    const value=send({type:'score',job:1,request:2,mask})
    expect(value).toEqual({type:'score',job:1,request:2,score:drain(originalScore(context.gray,context.near,context.width,context.height,context.rows,mask))})
    expect(Number.isFinite(value.score)).toBe(true)
  })
  it('releases previous image state at end and cannot score a closed job',()=>{
    const {mask,...context}=inputs();send({type:'begin',job:1,request:1,...context})
    scope.onmessage({data:{type:'end',job:1}})
    expect(send({type:'score',job:1,request:2,mask})).toEqual({type:'error',job:1,request:2})
  })
  it('uses only the new job image and rejects stale job IDs',()=>{
    const first=inputs(1),second=inputs(7)
    send({type:'begin',job:1,request:1,...first});send({type:'begin',job:2,request:2,...second})
    expect(send({type:'score',job:1,request:3,mask:first.mask})).toEqual({type:'error',job:1,request:3})
    const value=send({type:'score',job:2,request:4,mask:second.mask})
    expect(value.score).toBe(drain(originalScore(second.gray,second.near,second.width,second.height,second.rows,second.mask)))
  })
  it('rejects invalid typed or dimensional inputs instead of coercing their pixels',()=>{
    const {mask,...context}=inputs()
    for(const bad of [{gray:Array.from(context.gray)},{near:Float64Array.from(context.near)},{width:1.5},{gray:new Uint8Array(1)},{rows:81}]) {
      expect(send({type:'begin',job:4,request:8,...context,...bad})).toEqual({type:'error',job:4,request:8})
    }
    expect(send({type:'score',job:4,request:9,mask})).toEqual({type:'error',job:4,request:9})
  })
})
