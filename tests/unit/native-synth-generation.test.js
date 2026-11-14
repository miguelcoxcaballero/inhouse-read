import {beforeEach,expect,it,vi} from 'vitest'
const factories=vi.hoisted(()=>({supertonic:vi.fn(),hebrew:vi.fn()}))
// The runtimes are exports of the voice module, which the client calls by name.
vi.mock('../../src/js/rust-voice-ui.js',async original=>(await import('./helpers/voice-kernel-fakes.js')).withKernels(await original(),{voice_supertonic_create:options=>factories.supertonic(options),voice_hebrew_create:options=>factories.hebrew(options)}))
// The client's preparation, job chain and synthesis loop are rust-ui: the module is loaded as the reader loads it.
import './helpers/rust-ui-ready.js'
import {NativeSynthClient} from '../../src/js/readers/neural-voice/native-client.js'
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done});return{promise,resolve}}
const flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve()}
beforeEach(()=>{factories.supertonic.mockReset();factories.hebrew.mockReset()})
function fixture(){
 const session={release:vi.fn(async()=>{}),inputNames:[],outputNames:[]},ort={dispose:vi.fn(),InferenceSession:{create:vi.fn(async()=>session)}}
 const store={readConfig:vi.fn(async()=>({runtime:'supertonic3',config:{},indexer:[],styles:{}})),readRuntimeAssets:vi.fn(async()=>({})),readPhonemizerModel:vi.fn(async()=>new ArrayBuffer(8)),readModel:vi.fn(async()=>new ArrayBuffer(8))}
 const phon={destroy:vi.fn()},client=new NativeSynthClient({store,createOrt:()=>ort,createPhon:async()=>phon})
 return{client,store,session,ort}
}
it('releases a stale Supertonic runtime without replacing a reconnected session',async()=>{
 const gate=deferred(),old={dispose:vi.fn(async()=>{})},fresh={dispose:vi.fn(async()=>{})}
 factories.supertonic.mockReturnValueOnce(gate.promise).mockResolvedValueOnce(fresh)
 const {client}=fixture(),pending=client.prepare('old');pending.catch(()=>{})
 await flush();client.dispose();await client.prepare('new')
 gate.resolve(old);await expect(pending).rejects.toThrow('released')
 expect(old.dispose).toHaveBeenCalledOnce();expect(fresh.dispose).not.toHaveBeenCalled()
 expect(client.supertonic).toBe(fresh);expect(client.loaded).toBe('new');client.dispose()
})
it('destroys a Hebrew phonemizer completed after release before reading its acoustic model',async()=>{
 const gate=deferred(),old={destroy:vi.fn(async()=>{})};factories.hebrew.mockReturnValueOnce(gate.promise)
 const {client,store}=fixture();store.readConfig.mockResolvedValue({phoneme_type:'hebrew'})
 const pending=client.prepare('hebrew');pending.catch(()=>{});await flush();client.dispose()
 gate.resolve(old);await expect(pending).rejects.toThrow('released')
 expect(old.destroy).toHaveBeenCalledOnce();expect(store.readModel).not.toHaveBeenCalled();expect(client.hebrew).toBe(null)
})
it('rejects an old queued preparation before it can create another runtime',async()=>{
 const {client,store}=fixture(),first=client.prepare('old'),queued=client.prepare('queued')
 first.catch(()=>{});queued.catch(()=>{});client.dispose()
 await expect(first).rejects.toThrow('released');await expect(queued).rejects.toThrow('released')
 expect(store.readConfig).not.toHaveBeenCalled();expect(client.alive).toBe(false)
})
it('still reports an unloaded native voice after reuse without downloading or leaving a silent job',async()=>{
 const {client}=fixture();factories.supertonic.mockResolvedValue({dispose:vi.fn()});await client.prepare('voice');client.dispose()
 const handlers={onChunk:vi.fn(),onEnd:vi.fn(),onError:vi.fn()};client.synth({text:'No voice.'},handlers);await flush()
 expect(handlers.onError).toHaveBeenCalledOnce();expect(handlers.onError.mock.calls[0][0]).toMatchObject({message:'No voice loaded',code:'synth-failed'})
 expect(client.jobs.size).toBe(0);client.dispose()
})
it('asks the voice module for the Supertonic runtime as the page wrapper did and fills an empty utterance with 120 ms of silence',async()=>{
 const {client}=fixture(),requests=[]
 factories.supertonic.mockImplementation(async request=>{requests.push(request);return{dispose:vi.fn(),synthesize:async()=>({pcm:new Float32Array(),sampleRate:22051})}})
 await client.prepare('voice')
 expect(Object.keys(requests[0])).toEqual(['ort','buffers','config','indexer','styles','steps','random','yieldToMessages'])
 expect(requests[0].steps).toBe(6);expect(requests[0].random).toBe(Math.random);expect(requests[0].yieldToMessages()).toBeInstanceOf(Promise)
 const chunks=[],handlers={onChunk:chunk=>chunks.push(chunk),onEnd:vi.fn(),onError:vi.fn(),onPlan:vi.fn()}
 client.synth({text:'…',voice:'voice',rate:1},handlers);await flush();await flush()
 expect(handlers.onError).not.toHaveBeenCalled()
 // Math.round(22051 * 120 / 1000): 2646.12 -> 2646 zero samples, as silence() of the removed synth-flow.js made them.
 expect(chunks[0].pcm).toBeInstanceOf(Float32Array);expect(chunks[0].pcm.length).toBe(2646);expect(chunks[0].pcm.every(sample=>sample===0)).toBe(true)
 client.dispose()
})
