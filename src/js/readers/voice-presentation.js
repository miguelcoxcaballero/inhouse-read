import {readerUI} from './rust-ui-required.js'
import {nativeAudio} from './neural-voice/audio.js'
const ignore=value=>Promise.resolve(value).catch(()=>{})
export function startVoicePresentation(host,id){return readerUI().voice_engine_started(host,id,clearTimeout,nativeAudio)}
export function endVoicePresentation(host,id){return readerUI().voice_engine_ended(host,id)}
export function presentVoice(host,id=host.utteranceId,offset=0){return readerUI().voice_present(host,id,offset,clearTimeout,ignore)}
export function unpaintVoice(host){return readerUI().voice_unpaint(host,clearTimeout)}
