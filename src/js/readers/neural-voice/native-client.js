// The browser client remains a Worker. Android's ONNX executor uses the same
// Piper/Nakdimon/Supertonic models and PCM processing with native completion
// events. Only the small text/phoneme operations run in the page.
// The preparation, the job chain, the synthesis of a fragment and what the constructor builds are rust-ui
// (native_synth_client.rs, client_shells.rs); this class keeps the modules Rust is handed and what every fragment
// passes through: the handle of a job, the phonemizer closure and the ONNX Runtime tensors of a run.
import {createNativeOrt} from './native-ort.js'
import {createPhonemizer} from './phonemizer.js'
import {supertonicNoise} from './supertonic-plan.js'
import {loadedRustVoiceUI as voice} from '../../rust-voice-ui.js'
import {VoiceClientPlan} from './client-plan.js'
import {readerUI as ui} from '../rust-ui-required.js'
// `voice`: the voice module, whose kernels the Rust client calls by name; the rest is what its runtimes need from the page.
const kit={voice,noise:supertonicNoise,always:()=>true,noop(){},immediate:()=>Promise.resolve(),createNativeOrt,createPhonemizer,VoiceClientPlan}
export class NativeSynthClient {
  constructor(deps) { ui().native_client_construct(this,deps,kit) }
  get alive(){return !!this.ort}
  // One preparation at a time, the same promise for the voice being prepared: rust-ui client_prepare.rs.
  prepare(key) { const module=ui(); return module.native_client_begin(this,key,kit,module) }
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
  // The text -> phoneme ids of the loaded voice: Nakdimon + Hebrew rules, or espeak. The voice module calls it for
  // every marked word of a fragment, so it stays a function of the page.
  _phonemizer(kind,hebrew,phon,config){return async value=>voice().voice_host_limit_ids(kind===1?await hebrew.phonemize(value):await phon.phonemize(value,config.espeak.voice),config.num_symbols)}
  // One Piper run on the native executor: the original feeds, a copy of the audio and of the phoneme durations.
  async _run(ort,session,part,config,rate,speaker,durationOutput) {
    const feeds={input:new ort.Tensor('int64',BigInt64Array.from(part,BigInt),[1,part.length]),input_lengths:new ort.Tensor('int64',BigInt64Array.of(BigInt(part.length)),[1]),scales:new ort.Tensor('float32',voice().voice_host_piper_scales(config.inference||{},rate),[3])}
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
