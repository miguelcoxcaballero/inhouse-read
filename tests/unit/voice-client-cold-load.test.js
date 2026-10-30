// @vitest-environment node
import {readFileSync} from 'node:fs'
import {beforeEach,expect,it,vi} from 'vitest'
const loader=vi.hoisted(()=>({loaded:null,promise:null,require:vi.fn()}))
vi.mock('../../src/js/rust-voice-core.js',()=>({getRustVoiceCore:()=>loader.loaded,requireRustVoiceCore:()=>loader.require(),loadedRustVoiceCore:()=>{if(!loader.loaded)throw new Error('not loaded');return loader.loaded}}))
// The client's routing and preparation are rust-ui (synth_client.rs): the module is loaded as the reader loads it.
import './helpers/rust-ui-ready.js'
import {SynthClient} from '../../src/js/readers/neural-voice/client.js'
import {NativeSynthClient} from '../../src/js/readers/neural-voice/native-client.js'
const core=new WebAssembly.Instance(new WebAssembly.Module(readFileSync('src/wasm/inhouse_read_voice.wasm'))).exports
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return{promise,resolve,reject}}
const flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve()}
function fixture(){
 const worker={sent:[],postMessage(message){this.sent.push(message)},terminate:vi.fn(),reply(data){this.onmessage({data})},last(type){return this.sent.findLast(item=>item.type===type)}}
 const createWorker=vi.fn(()=>worker),readModel=vi.fn(async()=>new ArrayBuffer(8)),client=new SynthClient({createWorker,readModel,readConfig:async()=>({audio:{sample_rate:22050}})})
 return{client,worker,createWorker,readModel}
}
beforeEach(()=>{loader.loaded=null;loader.require.mockReset();loader.promise=deferred();loader.require.mockImplementation(()=>loader.promise.promise.then(value=>(loader.loaded=value)))})
it('does not fetch or instantiate a voice controller on construction or idle disposal',()=>{
 const {client,createWorker}=fixture();client.dispose();client.dispose()
 expect(loader.require).not.toHaveBeenCalled();expect(createWorker).not.toHaveBeenCalled();expect(client.plan.pointer).toBe(0)
})
it('deduplicates the bootstrap preparation and loads the small core only on requested speech',async()=>{
 const {client,worker,createWorker}=fixture(),ready=client.prepare('voice')
 expect(client.prepare('voice')).toBe(ready);await flush();expect(loader.require).toHaveBeenCalledOnce();expect(createWorker).not.toHaveBeenCalled()
 loader.promise.resolve(core);await flush();worker.reply({type:'ready',id:worker.last('init').id});await flush();worker.reply({type:'loaded',id:worker.last('load').id});await ready
 expect(client.loaded).toBe('voice');expect(createWorker).toHaveBeenCalledOnce();client.dispose()
})
it('cannot spawn an orphan worker when the first core download finishes after disposal',async()=>{
 const {client,worker,createWorker,readModel}=fixture(),ready=client.prepare('old'),failed=expect(ready).rejects.toMatchObject({code:'init-failed'})
 await flush();client.dispose();await failed;loader.promise.resolve(core);await flush()
 expect(createWorker).not.toHaveBeenCalled();expect(readModel).not.toHaveBeenCalled();expect(client.plan.pointer).toBe(0)
 const resumed=client.prepare('new');await flush();worker.reply({type:'ready',id:worker.last('init').id});await flush();worker.reply({type:'loaded',id:worker.last('load').id});await resumed
 expect(client.loaded).toBe('new');expect(loader.require).toHaveBeenCalledOnce();client.dispose()
})
it('reports core failures without constructing a worker or reading a model',async()=>{
 const {client,createWorker,readModel}=fixture(),ready=client.prepare('voice'),failed=expect(ready).rejects.toThrow('core unavailable')
 await flush();loader.promise.reject(new Error('core unavailable'));await failed
 expect(createWorker).not.toHaveBeenCalled();expect(readModel).not.toHaveBeenCalled();client.dispose()
})

it('preserves native errors and cancellation before the optional core exists without downloading it',async()=>{
 const client=new NativeSynthClient(),handlers={onChunk:vi.fn(),onEnd:vi.fn(),onError:vi.fn()}
 const first=client.synth({text:'Not prepared'},handlers);expect(first.id).toBe(1);await flush()
 expect(handlers.onError).toHaveBeenCalledOnce();expect(handlers.onError.mock.calls[0][0]).toMatchObject({message:'No voice loaded',code:'synth-failed'})
 const second=client.synth({text:'Cancelled'},handlers);expect(second.id).toBe(2);second.cancel();await flush()
 expect(handlers.onError).toHaveBeenCalledOnce();expect(loader.require).not.toHaveBeenCalled();client.dispose()
})
