import {getRustUI} from '../rust-ui.js'
import {langBase,recommendedNeuralFor} from './voice-catalog.js'
import {LegacyPolicy,DOWNLOAD_ERRORS} from './picker-policy-legacy.js'
const legacy=LegacyPolicy.prototype,key='inhouse-read-neural-offer-dismissed'
const read=()=>localStorage.getItem(key),write=value=>localStorage.setItem(key,value),now=()=>Date.now()
export function statePickerVoice(host,engine,voice){const ui=getRustUI();return ui?.picker_state?ui.picker_state(host,engine,voice,DOWNLOAD_ERRORS):legacy.state.call(host,engine,voice)}
export function dismissedPickerOffer(){const ui=getRustUI();return ui?.picker_dismissed?ui.picker_dismissed(read):legacy.dismissed()}
export function snoozedPickerOffer(host,base){const ui=getRustUI();return ui?.picker_snoozed?ui.picker_snoozed(host,base,now):legacy.snoozed.call(host,base)}
export function dismissPickerOffer(host){const ui=getRustUI();return ui?.picker_dismiss?ui.picker_dismiss(host,langBase,now,write):legacy.dismiss.call(host)}
export function offeredPickerVoice(host,engine,list){const ui=getRustUI();return ui?.picker_offer_for?ui.picker_offer_for(host,engine,list,langBase,recommendedNeuralFor,navigator.language):legacy.offerFor.call(host,engine,list)}
export function renderPickerOffer(host,engine,list){const ui=getRustUI();return ui?.picker_render_offer?ui.picker_render_offer(host,engine,list):legacy.renderOffer.call(host,engine,list)}
