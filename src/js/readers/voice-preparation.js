import {getRustUI} from '../rust-ui.js'
import {neuralEngine} from './neural-runtime.js'
import {planSpeech,firstCompleteSentenceOffset} from './speech-text.js'
import {LegacyPreparation} from './voice-preparation-legacy.js'
const legacy=LegacyPreparation.prototype
export async function prepareVoice(host,source,opening=false){const ui=getRustUI();return ui?.voice_prepare?ui.voice_prepare(host,source,opening,planSpeech,firstCompleteSentenceOffset):legacy.prepare.call(host,source,opening)}
export async function prepareVoiceOpening(host){const ui=getRustUI();return ui?.voice_prepare_opening?ui.voice_prepare_opening(host):legacy.prepareOpening.call(host)}
export async function prepareVoicePlayback(host,active=()=>true){const ui=getRustUI();return ui?.voice_prepare_playback?ui.voice_prepare_playback(host,active,neuralEngine):legacy.preparePlayback.call(host,active)}
export async function prepareNextVoice(host,generation){const ui=getRustUI();return ui?.voice_prepare_next?ui.voice_prepare_next(host,generation,(owner,generation)=>()=>ui.voice_next_active(owner,generation)):legacy.prepareNext.call(host,generation)}
export async function refreshVoiceBreaks(host){const ui=getRustUI();return ui?.voice_refresh_breaks?ui.voice_refresh_breaks(host,neuralEngine):legacy.refreshPageBreaks.call(host)}
