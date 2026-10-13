import {readerUI} from './rust-ui-required.js'
import {loadNeural,neuralEngine,unlockNeural} from './neural-runtime.js'
import {nativeAudio} from './neural-voice/audio.js'
export function restartVisibleVoice(host){return readerUI().voice_restart_visible(host)}
export async function playReadingVoice(host){return readerUI().voice_play(host,loadNeural,neuralEngine,unlockNeural,nativeAudio)}
