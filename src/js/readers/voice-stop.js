import {getRustUI} from '../rust-ui.js'
import {neuralEngine} from './neural-runtime.js'
import {nativeAudio} from './neural-voice/audio.js'
import {LegacyVoiceStop} from './voice-stop-legacy.js'
const legacy=LegacyVoiceStop.prototype,clearTimer=id=>clearTimeout(id)
export function pauseReadingVoice(host){const ui=getRustUI();return ui?.voice_pause?ui.voice_pause(host):legacy.pause.call(host)}
export function stopReadingVoice(host){const ui=getRustUI();return ui?.voice_stop?ui.voice_stop(host,clearTimer):legacy.stop.call(host)}
export function restartReadingVoice(host){const ui=getRustUI();return ui?.voice_restart?ui.voice_restart(host):legacy.restart.call(host)}
export function cancelReadingVoice(host,reason){const ui=getRustUI();return ui?.voice_cancel?ui.voice_cancel(host,reason,clearTimer,nativeAudio,neuralEngine):legacy.cancelUtterance.call(host,reason)}
export function retryReadingVoice(host){const ui=getRustUI();return ui?.voice_retry?ui.voice_retry(host):legacy.retryNeural.call(host)}
export function failReadingVoice(host,message){const ui=getRustUI();return ui?.voice_fail?ui.voice_fail(host,message):legacy.fail.call(host,message)}
