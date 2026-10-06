// The browser client remains a Worker. Android's ONNX executor uses the same
// Piper/Nakdimon/Supertonic models and PCM processing with native completion
// events. Only the small text/phoneme operations run in the page.
import {createNativeOrt} from './native-ort.js'
import {createPhonemizer} from './phonemizer.js'
import {createHebrewPhonemizer} from './hebrew.js'
import {createSupertonicRuntime} from './supertonic-runtime.js'
import {peakNormalize,trimSilence,fadeEdges,silence,concat,pauseAfter,restScale,splitSegments,limitIds,lengthScaleFor,PAUSE_MS} from './pcm.js'
const failure=message=>Object.assign(new Error(message),{code:'init-failed'})
export class NativeSynthClient {
  constructor({store,phonBase,env=globalThis,createOrt=createNativeOrt,createPhon=createPhonemizer}={}) {
    Object.assign(this,{store,phonBase,env,createOrt,createPhon})
    this.generation=0;this.seq=0;this.jobs=new Map();this.loading=null;this.loaded=null;this.config=null;this.ort=null
    this.chain=Promise.resolve();this.preparationChain=Promise.resolve()
  }
  get alive(){return !!this.ort}
  prepare(key) {
    if(!this.loading&&this.loaded===key)return Promise.resolve(this.config)
    if(this.loading?.key===key)return this.loading.promise
    const generation=this.generation
    const promise=this.preparationChain.then(()=>this.#prepare(key,generation))
    this.preparationChain=promise.catch(()=>{})
    this.loading={key,promise}
    promise.finally(()=>{if(this.loading?.promise===promise)this.loading=null}).catch(()=>{})
    return promise
  }
  async #prepare(key,generation) {
    const check=()=>{if(generation!==this.generation)throw failure('Voice released')}
    check();await this.chain;check()
    if(this.loaded===key)return this.config
    await this.session?.release();await this.hebrew?.destroy();await this.supertonic?.dispose();check()
    this.session=null;this.hebrew=null;this.supertonic=null;this.loaded=null
    this.ort ||= this.createOrt({env:this.env})
    const config=await this.store.readConfig(key);check()
    if(config.runtime==='supertonic3') {
      const buffers=await this.store.readRuntimeAssets(key);check()
      // Inference itself yields to the native executor. A microtask between
      // lightweight recipe steps adds no frozen MessageChannel dependency.
      this.supertonic=await createSupertonicRuntime({ort:this.ort,buffers,config:config.config,indexer:config.indexer,styles:config.styles,yieldToMessages:()=>Promise.resolve()})
    } else {
      if(config.phoneme_type==='hebrew') {
        const model=await this.store.readPhonemizerModel(key);check()
        this.hebrew=await createHebrewPhonemizer({ort:this.ort,model,config})
      } else if(!this.phon) {
        const phon=await this.createPhon({base:this.phonBase})
        if(generation!==this.generation){phon.destroy();throw failure('Voice released')}
        this.phon=phon
      }
      check();const model=await this.store.readModel(key);check()
      this.session=await this.ort.InferenceSession.create(new Uint8Array(model))
    }
    check();this.config=config;this.loaded=key;return config
  }
  synth(request,handlers) {
    const id=++this.seq,generation=this.generation
    this.jobs.set(id,handlers)
    const active=()=>generation===this.generation&&this.jobs.has(id)
    const work=this.chain.then(async()=>{
      if(!active())return
      try {await this.#synth(request,handlers,active);if(active()){this.jobs.delete(id);handlers.onEnd()}}
      catch(error){if(active()){this.jobs.delete(id);handlers.onError(Object.assign(error,{code:'synth-failed'}))}}
    })
    this.chain=work.catch(()=>{})
    return {id,cancel:()=>{this.jobs.delete(id)}}
  }
  async #synth({text,rate,speaker,lang,style},handlers,active) {
    const config=this.config,ort=this.ort,key=this.loaded
    if(!config||!ort)throw failure('No voice loaded')
    if(this.supertonic) {
      handlers.onPlan?.([Math.max(1,[...text].length)])
      const start=performance.now()
      const {pcm:raw,sampleRate}=await this.supertonic.synthesize(text,{lang,style,rate,isActive:active})
      if(!active())return
      if(!(raw instanceof Float32Array)||raw.some(n=>!Number.isFinite(n)))throw failure('Invalid audio')
      peakNormalize(raw)
      const pcm=raw.length?concat([fadeEdges(trimSilence(raw,sampleRate),sampleRate),silence(sampleRate,pauseAfter(text)*restScale(rate))]):silence(sampleRate,120)
      handlers.onChunk({index:0,last:true,pcm,sampleRate,ms:performance.now()-start});return
    }
    const ids=config.phoneme_type==='hebrew'?await this.hebrew.phonemize(text):await this.phon.phonemize(text,config.espeak.voice)
    if(!active())return
    const segments=splitSegments(limitIds(ids,config.num_symbols)),sampleRate=config.audio.sample_rate
    handlers.onPlan?.(segments.length?segments.map(part=>part.length):[0])
    if(!segments.length){handlers.onChunk({index:0,last:true,pcm:silence(sampleRate,120),sampleRate,ms:0});return}
    for(let index=0;index<segments.length;index++) {
      if(!active())return
      const part=segments[index],start=performance.now(),inference=config.inference||{}
      const feeds={input:new ort.Tensor('int64',BigInt64Array.from(part,BigInt),[1,part.length]),input_lengths:new ort.Tensor('int64',BigInt64Array.of(BigInt(part.length)),[1]),scales:new ort.Tensor('float32',Float32Array.of(inference.noise_scale??.667,lengthScaleFor(inference.length_scale??1,rate),inference.noise_w??.8),[3])}
      if(this.session.inputNames.includes('sid'))feeds.sid=new ort.Tensor('int64',BigInt64Array.of(BigInt(speaker||0)),[1])
      const out=await this.session.run(feeds)
      if(!active())return
      const tensor=out[this.session.outputNames[0]],raw=new Float32Array(tensor.data);tensor.dispose?.()
      peakNormalize(raw,{model:key})
      const speech=fadeEdges(trimSilence(raw,sampleRate),sampleRate),last=index===segments.length-1,rest=restScale(rate)
      const pcm=concat([index?silence(sampleRate,PAUSE_MS.sentence*rest):new Float32Array(),speech,last?silence(sampleRate,pauseAfter(text)*rest):new Float32Array()])
      handlers.onChunk({index,last,pcm,sampleRate,ms:performance.now()-start})
    }
  }
  dispose() {
    this.generation++;this.jobs.clear();this.loading=null;this.loaded=null;this.config=null
    this.phon?.destroy();this.phon=null;this.ort?.dispose();this.ort=null
    this.session=null;this.hebrew=null;this.supertonic=null;this.chain=Promise.resolve();this.preparationChain=Promise.resolve()
  }
}
