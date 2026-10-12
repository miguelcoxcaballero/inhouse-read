import {getRustUI} from '../rust-ui.js'
import {nativeAudio} from './neural-voice/audio.js'
import {LegacyVoicePresentation} from './voice-presentation-legacy.js'
const legacy=LegacyVoicePresentation.prototype,ignore=value=>Promise.resolve(value).catch(()=>{})
export function startVoicePresentation(host,id){const ui=getRustUI();return ui?.voice_engine_started?ui.voice_engine_started(host,id,clearTimeout,nativeAudio):legacy.engineStarted.call(host,id)}
export function endVoicePresentation(host,id){const ui=getRustUI();return ui?.voice_engine_ended?ui.voice_engine_ended(host,id):legacy.engineEnded.call(host,id)}
export function presentVoice(host,id=host.utteranceId,offset=0){const ui=getRustUI();return ui?.voice_present?ui.voice_present(host,id,offset,clearTimeout,ignore):legacy.present.call(host,id,offset)}
export function unpaintVoice(host){const ui=getRustUI();return ui?.voice_unpaint?ui.voice_unpaint(host,clearTimeout):legacy.unpaint.call(host)}
