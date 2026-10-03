// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { yieldToMessages } from '../../src/js/readers/neural-voice/task-yield.js'
const mocks=vi.hoisted(()=>({runtime:vi.fn(),phonemizer:vi.fn()}))
vi.mock('../../src/js/readers/neural-voice/supertonic-runtime.js',()=>({createSupertonicRuntime:mocks.runtime}))
vi.mock('../../src/js/readers/neural-voice/phonemizer.js',()=>({createPhonemizer:mocks.phonemizer}))
let messages,scope,runtime,session
const send=message=>scope.onmessage({data:message})
const pack={runtime:'supertonic3',config:{test:true},indexer:[1,2],styles:{F1:{test:true}}}
beforeEach(async()=>{
  vi.resetModules();messages=[]
  runtime={dispose:vi.fn(async()=>{}),synthesize:vi.fn(async()=>({pcm:Float32Array.from({length:500},(_,i)=>Math.sin(i/10)*.2),sampleRate:24000}))}
  session={release:vi.fn(async()=>{}),inputNames:['input'],outputNames:['output']}
  mocks.runtime.mockReset().mockResolvedValue(runtime);mocks.phonemizer.mockReset().mockResolvedValue({phonemize:vi.fn()})
  scope={postMessage:(message,transfer)=>messages.push({message,transfer})}
  vi.stubGlobal('self',scope);vi.stubGlobal('__neuralOrt',{create:vi.fn(async()=>session)})
  await import('../../src/js/readers/neural-voice/worker.js')
  await send({type:'init',id:1,ortBase:pathToFileURL(resolve('tests/unit/fixtures/neural-ort')+'/').href,phonBase:'https://test/phon/',runtime:'supertonic3'})
  expect(messages.at(-1).message.type).toBe('ready')
})
afterEach(async()=>{await send({type:'free',id:999});vi.unstubAllGlobals()})
async function superLoad(){await send({type:'load',id:2,voice:'supertonic3',config:pack,buffers:{vocoder:new ArrayBuffer(8)}})}
describe('worker runtime routing and cancellation',()=>{
  it('drains FIFO, cancels queued work and frees the actual worker with timers suspended',async()=>{
    await superLoad()
    const timer=vi.spyOn(globalThis,'setTimeout').mockImplementation(()=>0)
    try {
      await send({type:'synth',id:51,text:'Primero.',lang:'es',style:'F1'})
      await send({type:'synth',id:52,text:'Cancelado.',lang:'es',style:'F1'})
      await send({type:'synth',id:53,text:'Segundo.',lang:'es',style:'F1'})
      await send({type:'cancel',id:52})
      // free must wait for synthesis completion, without polling a timer.
      await send({type:'free',id:54})
      expect(runtime.synthesize.mock.calls.map(([text])=>text)).toEqual(['Primero.','Segundo.'])
      expect(messages.filter(({message})=>message.type==='end').map(({message})=>message.id)).toEqual([51,53])
      expect(messages.some(({message})=>message.id===52)).toBe(false)
      expect(messages.at(-1).message).toMatchObject({type:'freed',id:54})
      expect(runtime.dispose).toHaveBeenCalledOnce()
      expect(timer).not.toHaveBeenCalled()
    } finally { timer.mockRestore() }
  })
  it('cancels active synthesis and switches voice with timers suspended',async()=>{
    let finish
    runtime.synthesize.mockImplementation(()=>new Promise(resolve=>{finish=resolve}))
    await superLoad()
    const timer=vi.spyOn(globalThis,'setTimeout').mockImplementation(()=>0)
    try {
      await send({type:'synth',id:61,text:'Cancelar.',lang:'es',style:'F1'})
      await send({type:'cancel',id:61})
      const loading=send({type:'load',id:62,voice:'piper',config:{audio:{sample_rate:22050}},model:new ArrayBuffer(8)})
      await yieldToMessages()
      expect(runtime.dispose).not.toHaveBeenCalled()
      finish({pcm:new Float32Array(500),sampleRate:24000})
      await loading
      expect(messages.filter(({message})=>message.id===61).map(({message})=>message.type)).toEqual(['plan'])
      expect(messages.at(-1).message).toMatchObject({type:'loaded',id:62})
      expect(runtime.dispose).toHaveBeenCalledOnce()
      expect(timer).not.toHaveBeenCalled()
    } finally { timer.mockRestore() }
  })
  it('releases Piper before creating the shared runtime and forwards its exact configuration',async()=>{
    expect(mocks.phonemizer).not.toHaveBeenCalled()
    await send({type:'load',id:2,voice:'piper',config:{audio:{sample_rate:22050}},model:new ArrayBuffer(8)})
    expect(mocks.phonemizer).toHaveBeenCalledWith({base:'https://test/phon/'})
    await superLoad()
    expect(session.release).toHaveBeenCalledOnce()
    expect(mocks.runtime).toHaveBeenCalledWith(expect.objectContaining({config:pack.config,indexer:pack.indexer,styles:pack.styles,buffers:expect.any(Object)}))
    expect(messages.at(-1).message).toMatchObject({type:'loaded',id:2})
  })
  it('disposes Supertonic when switching to Piper and on free',async()=>{
    await superLoad()
    await send({type:'load',id:3,voice:'piper',config:{audio:{sample_rate:22050}},model:new ArrayBuffer(8)})
    expect(runtime.dispose).toHaveBeenCalledOnce()
    await send({type:'free',id:4});expect(session.release).toHaveBeenCalledOnce()
  })
  it('uses the requested language, profile and rate, with one validated transferable PCM chunk',async()=>{
    await superLoad();await send({type:'synth',id:5,text:'Hola.',lang:'es',style:'F1',rate:1.25})
    await vi.waitFor(()=>expect(messages.some(entry=>entry.message.type==='end'&&entry.message.id===5)).toBe(true))
    expect(runtime.synthesize).toHaveBeenCalledWith('Hola.',expect.objectContaining({lang:'es',style:'F1',rate:1.25,isActive:expect.any(Function)}))
    const replies=messages.filter(entry=>entry.message.id===5)
    expect(replies.map(entry=>entry.message.type)).toEqual(['plan','chunk','end'])
    expect(replies[1].message).toMatchObject({index:0,last:true,sampleRate:24000})
    expect(replies[1].message.pcm.every(Number.isFinite)).toBe(true)
    expect(replies[1].transfer).toEqual([replies[1].message.pcm.buffer])
    expect(mocks.phonemizer).not.toHaveBeenCalled()
  })
  it('cancels an active synthesis before any PCM or done can reach the page',async()=>{
    let finish,options
    runtime.synthesize.mockImplementation((_text,opts)=>{options=opts;return new Promise(resolve=>{finish=resolve})})
    await superLoad();await send({type:'synth',id:5,text:'Hola.',lang:'es',style:'F1'})
    await send({type:'cancel',id:5});expect(options.isActive()).toBe(false)
    finish({pcm:new Float32Array(500),sampleRate:24000})
    await send({type:'free',id:6})
    expect(messages.filter(entry=>entry.message.id===5).map(entry=>entry.message.type)).toEqual(['plan'])
    expect(runtime.dispose).toHaveBeenCalledOnce()
  })
  it('rejects nonfinite audio instead of passing it to Web Audio',async()=>{
    runtime.synthesize.mockResolvedValue({pcm:Float32Array.of(NaN),sampleRate:24000})
    await superLoad();await send({type:'synth',id:5,text:'Hola.',lang:'es',style:'F1'})
    await vi.waitFor(()=>expect(messages.some(entry=>entry.message.id===5&&entry.message.type==='error')).toBe(true))
    expect(messages.filter(entry=>entry.message.id===5).map(entry=>entry.message.type)).toEqual(['plan','error'])
  })
  it('keeps normalization-only ornaments as a short rest, matching the Piper policy',async()=>{
    runtime.synthesize.mockResolvedValue({pcm:new Float32Array(),sampleRate:24000})
    await superLoad();await send({type:'synth',id:5,text:'♥',lang:'es',style:'F1'})
    await vi.waitFor(()=>expect(messages.some(entry=>entry.message.id===5&&entry.message.type==='end')).toBe(true))
    const chunk=messages.find(entry=>entry.message.id===5&&entry.message.type==='chunk').message
    expect(chunk.pcm).toHaveLength(2880)
    expect(chunk.pcm.every(value=>value===0)).toBe(true)
    expect(messages.filter(entry=>entry.message.id===5).map(entry=>entry.message.type)).toEqual(['plan','chunk','end'])
  })
  it('keeps the worker usable after a runtime load failure',async()=>{
    mocks.runtime.mockRejectedValueOnce(new Error('invalid pack'))
    await superLoad();expect(messages.at(-1).message).toMatchObject({type:'error',id:2})
    await send({type:'load',id:3,voice:'piper',config:{audio:{sample_rate:22050}},model:new ArrayBuffer(8)})
    expect(messages.at(-1).message).toMatchObject({type:'loaded',id:3})
  })
  it('applies the extra speech gain only to the loaded NVCC Piper model',async()=>{
    mocks.phonemizer.mockResolvedValue({phonemize:vi.fn(async()=>[1,0,10,0,2])})
    session.run=vi.fn(async()=>({output:{data:Float32Array.from({length:22050},(_,i)=>.033*Math.sin(i/10)),dispose:vi.fn()}}))
    for(const [model,id,minimum,maximum]of [['no_NO-nvcc-medium',10,.39,.40],['no_NO-talesyntese-medium',11,.19,.20]]){
      await send({type:'load',id:id+100,voice:model,config:{audio:{sample_rate:22050},espeak:{voice:'nb'}},model:new ArrayBuffer(8)})
      await send({type:'synth',id,text:'Regnet falt.',rate:1,speaker:3})
      await vi.waitFor(()=>expect(messages.some(entry=>entry.message.id===id&&entry.message.type==='end')).toBe(true))
      const pcm=messages.find(entry=>entry.message.id===id&&entry.message.type==='chunk').message.pcm
      let peak=0;for(const value of pcm)peak=Math.max(peak,Math.abs(value))
      expect(peak).toBeGreaterThan(minimum);expect(peak).toBeLessThan(maximum)
    }
    expect(runtime.synthesize).not.toHaveBeenCalled()
  })
})
