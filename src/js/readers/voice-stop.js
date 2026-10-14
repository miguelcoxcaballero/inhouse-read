import {readerUI} from './rust-ui-required.js'
import {neuralEngine} from './neural-runtime.js'
import {nativeAudio} from './neural-voice/audio.js'
const clearTimer=id=>clearTimeout(id)
export function pauseReadingVoice(host){return readerUI().voice_pause(host)}
export function stopReadingVoice(host){return readerUI().voice_stop(host,clearTimer)}
export function restartReadingVoice(host){return readerUI().voice_restart(host)}
export function cancelReadingVoice(host,reason){return readerUI().voice_cancel(host,reason,clearTimer,nativeAudio,neuralEngine)}
export function retryReadingVoice(host){return readerUI().voice_retry(host)}
export function failReadingVoice(host,message){return readerUI().voice_fail(host,message)}
