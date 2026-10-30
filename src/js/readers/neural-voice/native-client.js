// The browser client remains a Worker. Android's ONNX executor uses the same
// Piper/Nakdimon/Supertonic models and PCM processing with native completion
// events. Only the small text/phoneme operations run in the page.
// The preparation, the job chain and the synthesis of a fragment are rust-ui (native_synth_client.rs); this class keeps
// the injected services, the ONNX Runtime tensors and runs, and the closures the promises call back.
import {createNativeOrt} from './native-ort.js'
import {createPhonemizer} from './phonemizer.js'
import {exposePiperDurations,phonemeMarks} from './piper-alignment.js'
import {createHebrewPhonemizer} from './hebrew.js'
import {createSupertonicRuntime} from './supertonic-runtime.js'
import {silence,splitSegments,limitIds,piperScales,finishPiper,finishSupertonic} from './synth-flow.js'
import {VoiceClientPlan} from './client-plan.js'
import {readerUI as ui} from '../rust-ui-required.js'
const failure=message=>Object.assign(new Error(message),{code:'init-failed'})
const kit={createSupertonicRuntime,createHebrewPhonemizer,exposePiperDurations,phonemeMarks,silence,splitSegments,finishPiper,finishSupertonic,immediate:()=>Promise.resolve()}
export class NativeSynthClient {
  constructor({store,phonBase,env=globalThis,createOrt=createNativeOrt,createPhon=createPhonemizer}={}) {
    Object.assign(this,{store,phonBase,env,createOrt,createPhon})
    this.plan=new VoiceClientPlan(()=>failure('Voice released'),{},true);this.jobs=new Map();this.loading=null;this.loaded=null;this.config=null;this.ort=null
    this.chain=Promise.resolve();this.preparationChain=Promise.resolve()
  }
  get alive(){return !!this.ort}
  prepare(key) {
    if(this.plan.model(8,key))return Promise.resolve(this.config)
    if(this.plan.preparing(key))return this.loading.promise
    const generation=this.plan.capture()
    const promise=this.preparationChain.then(()=>ui().native_client_prepare(this,key,generation,kit))
    this.preparationChain=promise.catch(()=>{})
    this.loading={key,promise};this.plan.beginPreparation(key)
    promise.finally(()=>{if(this.loading?.promise===promise){this.loading=null;this.plan.finishPreparation()}}).catch(()=>{})
    return promise
  }
  synth(request,handlers) {
    // Preserve the synchronous handle/error contract even before the optional
    // voice core exists. An invalid call must not download a model or WASM.
    if(this.plan.cold) {
      const id=this.plan.bootstrapId(),generation=this.plan.capture()
      this.jobs.set(id,handlers)
      this.chain=this.chain.then(()=>ui().native_client_unloaded(this,id,generation,handlers)).catch(()=>{})
      return{id,cancel:()=>{this.jobs.delete(id)}}
    }
    const id=this.plan.next('job'),generation=this.plan.capture()
    this.jobs.set(id,handlers)
    const active=()=>this.plan.active(id,generation)
    this.chain=this.chain.then(()=>ui().native_client_job(this,request,handlers,active,id,kit)).catch(()=>{})
    return {id,cancel:()=>{this.plan.cancel(id);this.jobs.delete(id)}}
  }
  // The text -> phoneme ids of the loaded voice: Nakdimon + Hebrew rules, or espeak.
  _phonemizer(kind,hebrew,phon,config){return async value=>limitIds(kind===1?await hebrew.phonemize(value):await phon.phonemize(value,config.espeak.voice),config.num_symbols)}
  // One Piper run on the native executor: the original feeds, a copy of the audio and of the phoneme durations.
  async _run(ort,session,part,config,rate,speaker,durationOutput) {
    const feeds={input:new ort.Tensor('int64',BigInt64Array.from(part,BigInt),[1,part.length]),input_lengths:new ort.Tensor('int64',BigInt64Array.of(BigInt(part.length)),[1]),scales:new ort.Tensor('float32',piperScales(config.inference||{},rate),[3])}
    if(session.inputNames.includes('sid'))feeds.sid=new ort.Tensor('int64',BigInt64Array.of(BigInt(speaker||0)),[1])
    const out=await session.run(feeds)
    const tensor=out[session.outputNames[0]],raw=new Float32Array(tensor.data)
    const durations=durationOutput&&out[durationOutput]?new Float32Array(out[durationOutput].data):null
    for(const value of Object.values(out))value.dispose?.()
    for(const value of Object.values(feeds))value.dispose?.()
    return {raw,durations}
  }
  dispose() { ui().native_client_dispose(this) }
}
