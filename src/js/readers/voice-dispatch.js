import {getRustUI} from '../rust-ui.js'
import {neuralEngine,neuralVoiceList} from './neural-runtime.js'
import {nativeAudio} from './neural-voice/audio.js'
import {langBase,isNeuralId} from './voice-catalog.js'
import {LegacyDispatch} from './voice-dispatch-legacy.js'
const legacy=LegacyDispatch.prototype,ignore=value=>Promise.resolve(value).catch(()=>{})
export function dispatchVoice(host){const ui=getRustUI();return ui?.voice_speak_current?ui.voice_speak_current(host,neuralVoiceList,langBase,isNeuralId,Date.now,(owner,promise,generation,index)=>{void promise.then(()=>ui.voice_join_ready(owner,generation,index))}):legacy.speakCurrent.call(host)}
export function dispatchNeuralVoice(host,id,text,voice){const ui=getRustUI();return ui?.voice_speak_neural?ui.voice_speak_neural(host,id,text,voice,neuralEngine,nativeAudio,clearTimeout,(owner,id)=>setTimeout(()=>ui.voice_wait_started(owner,id),900),(owner,id)=>queueMicrotask(()=>owner.engineFailed({id,reason:'synth-failed'}))):legacy.speakNeural.call(host,id,text,voice)}
export function failedVoiceEngine(host,detail){const ui=getRustUI();return ui?.voice_engine_failed?ui.voice_engine_failed(host,detail,clearTimeout,neuralEngine,ignore):legacy.engineFailed.call(host,detail)}
export function removedVoice(host,id){const ui=getRustUI();return ui?.voice_removed?ui.voice_removed(host,id):legacy.voiceRemoved.call(host,id)}
export function sleepVoice(host,minutes){const ui=getRustUI();return ui?.voice_set_sleep?ui.voice_set_sleep(host,minutes,clearTimeout,(owner,ms)=>setTimeout(()=>ui.voice_sleep_expired(owner),ms)):legacy.setSleep.call(host,minutes)}
