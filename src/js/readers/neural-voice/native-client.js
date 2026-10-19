// The browser client remains a Worker. Android's ONNX executor uses the same
// Piper/Nakdimon/Supertonic models and PCM processing with native completion
// events. Only the small text/phoneme operations run in the page.
import {createNativeOrt} from './native-ort.js'
import {createPhonemizer} from './phonemizer.js'
import {exposePiperDurations,phonemeMarks} from './piper-alignment.js'
import {createHebrewPhonemizer} from './hebrew.js'
import {createSupertonicRuntime} from './supertonic-runtime.js'
import {silence,splitSegments,limitIds,lengthScaleFor,synthesisRate,finishPiper,finishSupertonic} from './synth-flow.js'
import {VoiceClientPlan} from './client-plan.js'
const failure=message=>Object.assign(new Error(message),{code:'init-failed'})
export class NativeSynthClient {
  constructor({store,phonBase,env=globalThis,createOrt=createNativeOrt,createPhon=createPhonemizer}={}) {
    Object.assign(this,{store,phonBase,env,createOrt,createPhon})
    this.plan=new VoiceClientPlan(()=>failure('Voice released'));this.jobs=new Map();this.loading=null;this.loaded=null;this.config=null;this.ort=null
    this.chain=Promise.resolve();this.preparationChain=Promise.resolve()
  }
  get alive(){return !!this.ort}
  prepare(key) {
    if(this.plan.model(8,key))return Promise.resolve(this.config)
    if(this.plan.preparing(key))return this.loading.promise
    const generation=this.plan.capture()
    const promise=this.preparationChain.then(()=>this.#prepare(key,generation))
    this.preparationChain=promise.catch(()=>{})
    this.loading={key,promise};this.plan.beginPreparation(key)
    promise.finally(()=>{if(this.loading?.promise===promise){this.loading=null;this.plan.finishPreparation()}}).catch(()=>{})
    return promise
  }
  async #prepare(key,generation) {
    const check=()=>{if(!this.plan.current(generation))throw failure('Voice released')}
    if(!this.plan.pending(generation))throw failure('Voice released')
    // Only an actual voice preparation loads the small shared runtime ledger.
    const voiceCore=this.plan.ready();voiceCore.catch(()=>{})
    await voiceCore;check();await this.chain;check()
    if(this.plan.model(0,key))return this.config
    await this.session?.release();await this.hebrew?.destroy();await this.supertonic?.dispose();check()
    this.session=null;this.hebrew=null;this.supertonic=null;this.loaded=null;this.plan.model(3)
    this.ort ||= this.createOrt({env:this.env})
    const ort=this.ort
    const config=await this.store.readConfig(key);check()
    if(config.runtime==='supertonic3') {
      const buffers=await this.store.readRuntimeAssets(key);check()
      // Inference itself yields to the native executor. A microtask between
      // lightweight recipe steps adds no frozen MessageChannel dependency.
      const runtime=await createSupertonicRuntime({ort,buffers,config:config.config,indexer:config.indexer,styles:config.styles,yieldToMessages:()=>Promise.resolve()})
      if(!this.plan.current(generation)){await runtime.dispose();check()}
      this.supertonic=runtime
    } else if(config.phoneme_type==='hebrew') {
      // Both Hebrew graphs share the single native upload slot.
      const phonModel=await this.store.readPhonemizerModel(key);check()
      const hebrew=await createHebrewPhonemizer({ort,model:phonModel,config})
      if(!this.plan.current(generation)){await hebrew.destroy();check()}
      this.hebrew=hebrew
      const model=await this.store.readModel(key);check()
      const aligned=exposePiperDurations(new Uint8Array(model));this.durationOutput=aligned.name
      const session=await ort.InferenceSession.create(aligned.bytes)
      if(!this.plan.current(generation)){await session.release();check()}
      this.session=session
    } else {
      // Reading/uploading the acoustic model and initializing the phonemizer
      // are independent. In Android they used to run entirely in series.
      const phonReady=(async()=>{
        if(!this.phon) {
          const phon=await this.createPhon({base:this.phonBase})
          if(!this.plan.current(generation)){phon.destroy();throw failure('Voice released')}
          this.phon=phon
        }
      })()
      let session
      const modelReady=(async()=>{
        const model=await this.store.readModel(key);check()
        const aligned=exposePiperDurations(new Uint8Array(model));this.durationOutput=aligned.name
        session=await ort.InferenceSession.create(aligned.bytes);check()
      })()
      // Drain both jobs on error: a late job must never install resources into
      // the next requested voice. The bridge still bounds every upload slice.
      const outcomes=await Promise.allSettled([phonReady,modelReady])
      const failed=outcomes.find(result=>result.status==='rejected')
      if(failed){try{await session?.release()}catch{};throw failed.reason}
      check();this.session=session
    }
    check();this.plan.model(2,key);this.config=config;this.loaded=key;return config
  }
  synth(request,handlers) {
    // Preserve the synchronous handle/error contract even before the optional
    // voice core exists. An invalid call must not download a model or WASM.
    if(this.plan.cold) {
      const id=this.plan.bootstrapId(),generation=this.plan.capture()
      this.jobs.set(id,handlers)
      this.chain=this.chain.then(()=>{
        if(this.plan.pending(generation)&&this.jobs.delete(id))handlers.onError(Object.assign(failure('No voice loaded'),{code:'synth-failed'}))
      }).catch(()=>{})
      return{id,cancel:()=>{this.jobs.delete(id)}}
    }
    const id=this.plan.next('job'),generation=this.plan.capture()
    this.jobs.set(id,handlers)
    const active=()=>this.plan.active(id,generation)
    const work=this.chain.then(async()=>{
      if(!active())return
      try {await this.#synth(request,handlers,active);if(active()){this.plan.cancel(id);this.jobs.delete(id);handlers.onEnd()}}
      catch(error){if(active()){this.plan.cancel(id);this.jobs.delete(id);handlers.onError(Object.assign(error,{code:'synth-failed'}))}}
    })
    this.chain=work.catch(()=>{})
    return {id,cancel:()=>{this.plan.cancel(id);this.jobs.delete(id)}}
  }
  async #synth({text,rate,speaker,lang,style,marks=[]},handlers,active) {
    const config=this.config,ort=this.ort,key=this.loaded,session=this.session,phon=this.phon,hebrew=this.hebrew,durationOutput=this.durationOutput
    if(!config||!ort)throw failure('No voice loaded')
    if(this.supertonic) {
      handlers.onPlan?.([Math.max(1,[...text].length)])
      const start=performance.now()
      const {pcm:raw,sampleRate,marks:timeline=[]}=await this.supertonic.synthesize(text,{lang,style,rate,marks,isActive:active})
      if(!active())return
      if(!(raw instanceof Float32Array))throw failure('Invalid audio')
      const done=finishSupertonic(raw,text,timeline,{sampleRate,rate})
      if(!done)throw failure('Invalid audio') // a sample that is not a number
      const pcm=raw.length?done.pcm:silence(sampleRate,120)
      handlers.onChunk({index:0,last:true,pcm,sampleRate,ms:performance.now()-start,marks:done.marks});return
    }
    const phonemize=async value=>limitIds(config.phoneme_type==='hebrew'?await hebrew.phonemize(value):await phon.phonemize(value,config.espeak.voice),config.num_symbols)
    const ids=await phonemize(text)
    const points=durationOutput?await phonemeMarks(text,marks,ids,phonemize):[]
    if(!active())return
    const segments=splitSegments(ids),sampleRate=config.audio.sample_rate
    handlers.onPlan?.(segments.length?segments.map(part=>part.length):[0])
    if(!segments.length){handlers.onChunk({index:0,last:true,pcm:silence(sampleRate,120),sampleRate,ms:0});return}
    for(let index=0;index<segments.length;index++) {
      if(!active())return
      const part=segments[index],start=performance.now(),inference=config.inference||{}
      const feeds={input:new ort.Tensor('int64',BigInt64Array.from(part,BigInt),[1,part.length]),input_lengths:new ort.Tensor('int64',BigInt64Array.of(BigInt(part.length)),[1]),scales:new ort.Tensor('float32',Float32Array.of(inference.noise_scale??.667,lengthScaleFor(inference.length_scale??1,synthesisRate(rate)),inference.noise_w??.8),[3])}
      if(session.inputNames.includes('sid'))feeds.sid=new ort.Tensor('int64',BigInt64Array.of(BigInt(speaker||0)),[1])
      const out=await session.run(feeds)
      const tensor=out[session.outputNames[0]],raw=new Float32Array(tensor.data)
      const durations=durationOutput&&out[durationOutput]?new Float32Array(out[durationOutput].data):null
      for(const value of Object.values(out))value.dispose?.()
      for(const value of Object.values(feeds))value.dispose?.()
      if(!active())return
      const last=index===segments.length-1
      const done=finishPiper(raw,durations,points,text,{sampleRate,model:key,rate,last,first:index===0,base:segments.slice(0,index).reduce((n,p)=>n+p.length,0),count:part.length})
      handlers.onChunk({index,last,pcm:done.pcm,sampleRate,ms:performance.now()-start,marks:done.marks})
    }
  }
  dispose() {
    this.plan.dispose();this.jobs.clear();this.loading=null;this.loaded=null;this.config=null
    this.phon?.destroy();this.phon=null;this.ort?.dispose();this.ort=null
    this.session=null;this.hebrew=null;this.supertonic=null;this.chain=Promise.resolve();this.preparationChain=Promise.resolve()
  }
}
