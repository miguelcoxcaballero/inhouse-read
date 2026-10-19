// Host ownership of the tiny Rust voice-client ledger. Only prepare() requests
// the voice core; constructing, stopping or disposing a client never loads it.
import {getRustVoiceCore,requireRustVoiceCore} from '../../rust-voice-core.js'
const kinds={stage:1,error:2,plan:3,chunk:4,end:5}
const number=value=>typeof value==='number'?value:NaN
const finalizer=typeof FinalizationRegistry==='function'?new FinalizationRegistry(({core,pointer})=>core.voice_client_free(pointer)):null
export class VoiceClientPlan {
  constructor(released,ticket={}){this.released=released;this.pointer=0;this.core=null;this.seed=[0,0];this.ticket=ticket;this.boot=null;this.bootstrapPreparation=null}
  capture(){return{ticket:this.ticket,generation:this.pointer?this.core.voice_client_field(this.pointer,1):this.seed[1]}}
  ready(){
    if(this.pointer)return Promise.resolve(this)
    const ticket=this.ticket,existing=getRustVoiceCore()
    const attach=core=>{
      if(ticket!==this.ticket)throw this.released()
      if(this.pointer)return this
      this.core=core;this.pointer=core.voice_client_new(...this.seed)
      if(!this.pointer)throw new Error('No se pudo reservar el estado de voz')
      finalizer?.register(this,{core,pointer:this.pointer},this)
      if(this.bootstrapPreparation){this.model(6,this.bootstrapPreparation.key);this.bootstrapPreparation=null}
      return this
    }
    if(existing){attach(existing);return Promise.resolve(this)}
    if(this.boot)return this.boot
    const boot=requireRustVoiceCore().then(attach)
    this.boot=boot
    boot.then(()=>{if(this.boot===boot)this.boot=null},()=>{if(this.boot===boot)this.boot=null})
    return boot
  }
  preparing(key){return this.pointer?this.model(5,key):!!this.bootstrapPreparation&&this.bootstrapPreparation.key===key}
  beginPreparation(key){if(this.pointer)this.model(6,key);else this.bootstrapPreparation={key}}
  finishPreparation(){if(this.pointer)this.model(7);this.bootstrapPreparation=null}
  get cold(){return !this.pointer&&!getRustVoiceCore()}
  bootstrapId(){return ++this.seed[0]}
  pending(token){return token.ticket===this.ticket}
  current(token){return token.ticket===this.ticket&&!!this.pointer&&!!this.core.voice_client_current(this.pointer,token.generation)}
  next(kind){
    // A reused native handle can report an unloaded-voice job after dispose.
    // Reattach only an already-loaded core; this never starts a download.
    if(!this.pointer&&getRustVoiceCore())this.ready()
    if(!this.pointer)throw this.released()
    return this.core.voice_client_next(this.pointer,kind==='call'?1:kind==='job'?2:0)
  }
  active(id,token){return token.ticket===this.ticket&&!!this.pointer&&!!this.core.voice_client_active(this.pointer,id,token.generation)}
  cancel(id){return !!this.pointer&&!!this.core.voice_client_cancel(this.pointer,number(id))}
  message(message){return this.pointer?this.core.voice_client_message(this.pointer,kinds[message.type]||0,number(message.id),number(message.domain),number(message.stage),number(message.part)):0}
  writeKey(key){
    const value=String(key),pointer=this.core.voice_client_key_buffer(this.pointer,value.length)
    if(!pointer)throw new Error('Identificador de voz no válido')
    const units=new Uint16Array(this.core.memory.buffer,pointer,value.length)
    for(let index=0;index<value.length;index++)units[index]=value.charCodeAt(index)
  }
  model(operation,key){
    if(!this.pointer)return false
    if(arguments.length>1)this.writeKey(key)
    return !!this.core.voice_client_model(this.pointer,operation)
  }
  classifyRuntime(config){
    const runtime=typeof config.runtime==='string'?config.runtime:'',phonemes=typeof config.phoneme_type==='string'?config.phoneme_type:''
    this.writeKey(runtime+phonemes)
    return this.core.voice_worker_runtime(this.pointer,runtime.length)
  }
  get runtimeKind(){return this.pointer?this.core.voice_client_field(this.pointer,7):0}
  clearQueue(){if(this.pointer)this.core.voice_facade_clear_queue(this.pointer)}
  command(type){if(!this.pointer||typeof type!=='string')return 0;this.writeKey(type);return this.core.voice_worker_command(this.pointer)}
  get draining(){return !!this.pointer&&!!this.core.voice_client_field(this.pointer,4)}
  get diagnostics(){return !!this.pointer&&!!this.core.voice_client_field(this.pointer,5)}
  set diagnostics(value){if(this.pointer)this.core.voice_worker_diagnostics(this.pointer,value?1:0)}
  enqueue(id){return this.core.voice_worker_enqueue(this.pointer,number(id))}
  take(){return this.core.voice_worker_next(this.pointer)}
  workerActive(id){return !!this.pointer&&!!this.core.voice_worker_active(this.pointer,id)}
  stopDraining(){if(this.pointer)this.core.voice_worker_stop_draining(this.pointer)}
  invalidate(){this.ticket={};this.boot=null;this.bootstrapPreparation=null;if(this.pointer)this.core.voice_client_reset(this.pointer)}
  dispose(){
    this.ticket={};this.boot=null;this.bootstrapPreparation=null
    if(!this.pointer)return
    const {core,pointer}=this
    core.voice_client_reset(pointer)
    this.seed=[core.voice_client_field(pointer,0),core.voice_client_field(pointer,1)]
    finalizer?.unregister(this);this.pointer=0;core.voice_client_free(pointer)
  }
}
