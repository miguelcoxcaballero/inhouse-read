import {readerUI} from './rust-ui-required.js'
import {langBase,recommendedNeuralFor} from './voice-catalog.js'
import {DOWNLOAD_ERRORS} from './picker-messages.js'
const key='inhouse-read-neural-offer-dismissed'
const read=()=>localStorage.getItem(key),write=value=>localStorage.setItem(key,value),now=()=>Date.now()
export function statePickerVoice(host,engine,voice){return readerUI().picker_state(host,engine,voice,DOWNLOAD_ERRORS)}
export function dismissedPickerOffer(){return readerUI().picker_dismissed(read)}
export function snoozedPickerOffer(host,base){return readerUI().picker_snoozed(host,base,now)}
export function dismissPickerOffer(host){return readerUI().picker_dismiss(host,langBase,now,write)}
export function offeredPickerVoice(host,engine,list){return readerUI().picker_offer_for(host,engine,list,langBase,recommendedNeuralFor,navigator.language)}
export function renderPickerOffer(host,engine,list){return readerUI().picker_render_offer(host,engine,list)}
