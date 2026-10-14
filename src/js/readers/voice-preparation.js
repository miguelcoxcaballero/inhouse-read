import {readerUI} from './rust-ui-required.js'
import {neuralEngine} from './neural-runtime.js'
import {planSpeech,firstCompleteSentenceOffset} from './speech-text.js'
export async function prepareVoice(host,source,opening=false){return readerUI().voice_prepare(host,source,opening,planSpeech,firstCompleteSentenceOffset)}
export async function prepareVoiceOpening(host){return readerUI().voice_prepare_opening(host)}
export async function prepareVoicePlayback(host,active=()=>true){return readerUI().voice_prepare_playback(host,active,neuralEngine)}
export async function prepareNextVoice(host,generation){const ui=readerUI();return ui.voice_prepare_next(host,generation,(owner,generation)=>()=>ui.voice_next_active(owner,generation))}
export async function refreshVoiceBreaks(host){return readerUI().voice_refresh_breaks(host,neuralEngine)}
