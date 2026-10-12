import {getRustUI} from '../rust-ui.js'
import {declaredLanguage,isNeuralId,langBase,resolveVoice} from './voice-catalog.js'
import {neuralVoiceList} from './neural-runtime.js'
import {LegacyVoiceSelection} from './voice-selection-legacy.js'
const legacy=LegacyVoiceSelection.prototype,deviceLanguage=()=>navigator.language
export function selectReadingVoice(host,text){const ui=getRustUI();return ui?.voice_for?ui.voice_for(host,text,neuralVoiceList,isNeuralId,declaredLanguage,langBase,resolveVoice,deviceLanguage):legacy.voiceFor.call(host,text)}
export function upcomingVoiceItems(host,voice){const ui=getRustUI();return ui?.voice_upcoming?ui.voice_upcoming(host,voice):legacy.upcomingFor.call(host,voice)}
export function voiceAudioItem(item){const ui=getRustUI();return ui?.voice_audio_item?ui.voice_audio_item(item):legacy.audioItem(item)}
export function voiceNeedsJoin(host,item,index){const ui=getRustUI();return ui?.voice_needs_join?ui.voice_needs_join(host,item,index):legacy.needsPageJoin.call(host,item,index)}
