import {getRustUI} from '../rust-ui.js'
import {loadNeural,neuralEngine,unlockNeural} from './neural-runtime.js'
import {nativeAudio} from './neural-voice/audio.js'
import {LegacyVoiceStart} from './voice-start-legacy.js'
const legacy=LegacyVoiceStart.prototype
export function restartVisibleVoice(host){const ui=getRustUI();return ui?.voice_restart_visible?ui.voice_restart_visible(host):legacy.restartFromVisiblePage.call(host)}
export async function playReadingVoice(host){const ui=getRustUI();return ui?.voice_play?ui.voice_play(host,loadNeural,neuralEngine,unlockNeural,nativeAudio):legacy.play.call(host)}
