import {beforeEach,expect,it,vi} from 'vitest'
const factories=vi.hoisted(()=>({supertonic:vi.fn(),hebrew:vi.fn()}))
vi.mock('../../src/js/readers/neural-voice/supertonic-runtime.js',()=>({createSupertonicRuntime:factories.supertonic}))
vi.mock('../../src/js/readers/neural-voice/hebrew.js',()=>({createHebrewPhonemizer:factories.hebrew}))
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
