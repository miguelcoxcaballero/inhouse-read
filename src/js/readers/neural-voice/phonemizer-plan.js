// Emscripten objects and immutable dictionary bytes stay in their host heaps.
// Only explicit phonemizer creation requests the small voice-domain planner.
import {requireRustVoiceCore} from '../../rust-voice-core.js'
const finalizer=typeof FinalizationRegistry==='function'?new FinalizationRegistry(({core,pointer})=>core.phonemizer_runtime_free(pointer)):null
export class PhonemizerPlan {
  static async create(limit){return new PhonemizerPlan(await requireRustVoiceCore(),Number(limit))}
  constructor(core,limit){
    this.core=core;this.pointer=core.phonemizer_runtime_new(limit)
    if(!this.pointer)throw new Error('Cannot allocate phonemizer state')
    finalizer?.register(this,{core,pointer:this.pointer},this)
  }
  begin(){return this.pointer?this.core.phonemizer_runtime_begin(this.pointer):-1}
  build(){return this.pointer?this.core.phonemizer_runtime_build(this.pointer):NaN}
  current(token){return !!this.pointer&&!!this.core.phonemizer_runtime_current(this.pointer,token)}
  accept(token){return !!this.pointer&&!!this.core.phonemizer_runtime_accept(this.pointer,token)}
  attempt(){return !!this.pointer&&!!this.core.phonemizer_runtime_attempt(this.pointer)}
  retry(){return !!this.pointer&&!!this.core.phonemizer_runtime_retry(this.pointer)}
  dictionary(id,operation=0){return this.pointer?this.core.phonemizer_runtime_dictionary(this.pointer,id,operation):-1}
  close(){
    if(!this.pointer)return
    const {core,pointer}=this;this.pointer=0;finalizer?.unregister(this)
    core.phonemizer_runtime_close(pointer);core.phonemizer_runtime_free(pointer)
  }
}
