import {describe,it,expect,vi} from 'vitest'
import {NativeSynthClient} from '../../src/js/readers/neural-voice/native-client.js'
import {NativeTensor} from '../../src/js/readers/neural-voice/native-ort.js'
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve}}
const flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve()}
function fixture({block=null}={}) {
  const runs=[],release=vi.fn(async()=>{}),dispose=vi.fn(),phon={phonemize:vi.fn(async()=>[1,0,4,0,2]),destroy:vi.fn()}
  const ort={Tensor:NativeTensor,dispose,InferenceSession:{create:vi.fn(async()=>({inputNames:['input','input_lengths','scales','sid'],outputNames:['output'],release,run:async feeds=>{
    runs.push(feeds);if(block)await block.promise
    return{output:new NativeTensor('float32',Float32Array.from({length:6000},(_,i)=>Math.sin(i*.1)*.5),[1,1,6000])}
  }}))}}
  const config={num_symbols:256,espeak:{voice:'es-419'},audio:{sample_rate:22050},inference:{noise_scale:.667,length_scale:1,noise_w:.8}}
  const store={readConfig:vi.fn(async()=>config),readModel:vi.fn(async()=>new Uint8Array([1,2,3]).buffer)}
  const client=new NativeSynthClient({store,phonBase:'https://example.test/phon/',createOrt:()=>ort,createPhon:async()=>phon})
  return{client,runs,release,dispose,phon,store,ort}
}
describe('native natural synthesis client',()=>{
  it('uses the original Piper feeds, speaker, rate and genuine PCM pipeline',async()=>{
    const {client,runs,phon,store}=fixture();await client.prepare('es_AR-davefx-medium')
    const handlers={onPlan:vi.fn(),onChunk:vi.fn(),onEnd:vi.fn(),onError:vi.fn()}
    client.synth({text:'Hola, Argentina.',rate:1.25,speaker:3},handlers);await flush()
    expect(phon.phonemize).toHaveBeenCalledWith('Hola, Argentina.','es-419')
    expect(runs[0].sid.data).toEqual(BigInt64Array.of(3n));expect(runs[0].scales.data[1]).toBeCloseTo(.8)
    expect(handlers.onError).not.toHaveBeenCalled();expect(handlers.onEnd).toHaveBeenCalledOnce()
    const chunk=handlers.onChunk.mock.calls[0][0]
    expect(chunk.pcm).toBeInstanceOf(Float32Array);expect(chunk.pcm.some(n=>Math.abs(n)>.05)).toBe(true)
    expect(chunk.last).toBe(true);expect(chunk.sampleRate).toBe(22050)
    await client.prepare('es_AR-davefx-medium');expect(store.readModel).toHaveBeenCalledOnce()
    client.dispose()
  })
  it('serializes fragments and cancellation never delivers late audio',async()=>{
    const block=deferred(),{client,runs}=fixture({block});await client.prepare('voice')
    const first={onChunk:vi.fn(),onEnd:vi.fn(),onError:vi.fn()},second={onChunk:vi.fn(),onEnd:vi.fn(),onError:vi.fn()}
    const job=client.synth({text:'Primero.',rate:1},first)
    client.synth({text:'Segundo.',rate:1},second);await flush();expect(runs.length).toBe(1)
    job.cancel();block.resolve();await flush()
    expect(first.onChunk).not.toHaveBeenCalled();expect(first.onEnd).not.toHaveBeenCalled();expect(first.onError).not.toHaveBeenCalled()
    expect(runs.length).toBe(2);expect(second.onEnd).toHaveBeenCalledOnce();client.dispose()
  })
  it('releases all native resources and suppresses a stopped inference',async()=>{
    const block=deferred(),{client,dispose,phon}=fixture({block});await client.prepare('voice')
    const handlers={onChunk:vi.fn(),onEnd:vi.fn(),onError:vi.fn()}
    client.synth({text:'Detener ahora.',rate:1},handlers);await flush();client.dispose();block.resolve();await flush()
    expect(handlers.onChunk).not.toHaveBeenCalled();expect(handlers.onEnd).not.toHaveBeenCalled();expect(handlers.onError).not.toHaveBeenCalled()
    expect(dispose).toHaveBeenCalledOnce();expect(phon.destroy).toHaveBeenCalledOnce();expect(client.alive).toBe(false)
  })
  it('cannot deliver an old voice after disposal during preparation',async()=>{
    const block=deferred(),{client,store}=fixture();store.readConfig=()=>block.promise
    const prepared=client.prepare('old');await flush();client.dispose();block.resolve({runtime:'piper'})
    await expect(prepared).rejects.toThrow('released');expect(client.loaded).toBe(null)
  })
  it('destroys a phonemizer completed after its generation was released',async()=>{
    const pending=deferred(),{client,phon}=fixture();client.createPhon=()=>pending.promise
    const prepared=client.prepare('old');await flush();client.dispose();pending.resolve(phon)
    await expect(prepared).rejects.toThrow('released');expect(phon.destroy).toHaveBeenCalledOnce();expect(client.phon).toBe(null)
  })
  it('serializes a return to the previous voice behind an already requested replacement',async()=>{
    const gate=deferred(),{client,store}=fixture();await client.prepare('first')
    const read=store.readConfig;store.readConfig=key=>key==='second'?gate.promise:read(key)
    const second=client.prepare('second'),first=client.prepare('first');let settled=false
    first.then(()=>settled=true);await flush();expect(settled).toBe(false)
    gate.resolve(await read('second'));await second;await first
    expect(client.loaded).toBe('first');client.dispose()
  })
})
