import {readerUI} from './rust-ui-required.js'
import {declaredLanguage,isNeuralId,langBase,resolveVoice} from './voice-catalog.js'
import {neuralVoiceList} from './neural-runtime.js'
const deviceLanguage=()=>navigator.language
export function selectReadingVoice(host,text){return readerUI().voice_for(host,text,neuralVoiceList,isNeuralId,declaredLanguage,langBase,resolveVoice,deviceLanguage)}
export function upcomingVoiceItems(host,voice){return readerUI().voice_upcoming(host,voice)}
export function voiceAudioItem(item){return readerUI().voice_audio_item(item)}
export function voiceNeedsJoin(host,item,index){return readerUI().voice_needs_join(host,item,index)}
