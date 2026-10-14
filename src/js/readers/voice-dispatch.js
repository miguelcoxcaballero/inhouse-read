import {readerUI} from './rust-ui-required.js'
import {neuralEngine,neuralVoiceList} from './neural-runtime.js'
import {nativeAudio} from './neural-voice/audio.js'
import {langBase,isNeuralId} from './voice-catalog.js'
const ignore=value=>Promise.resolve(value).catch(()=>{})
export function dispatchVoice(host){const ui=readerUI();return ui.voice_speak_current(host,neuralVoiceList,langBase,isNeuralId,Date.now,(owner,promise,generation,index)=>{void promise.then(()=>ui.voice_join_ready(owner,generation,index))})}
export function dispatchNeuralVoice(host,id,text,voice){const ui=readerUI();return ui.voice_speak_neural(host,id,text,voice,neuralEngine,nativeAudio,clearTimeout,(owner,id)=>setTimeout(()=>ui.voice_wait_started(owner,id),900),(owner,id)=>queueMicrotask(()=>owner.engineFailed({id,reason:'synth-failed'})))}
export function failedVoiceEngine(host,detail){return readerUI().voice_engine_failed(host,detail,clearTimeout,neuralEngine,ignore)}
export function removedVoice(host,id){return readerUI().voice_removed(host,id)}
export function sleepVoice(host,minutes){const ui=readerUI();return ui.voice_set_sleep(host,minutes,clearTimeout,(owner,ms)=>setTimeout(()=>ui.voice_sleep_expired(owner),ms))}
