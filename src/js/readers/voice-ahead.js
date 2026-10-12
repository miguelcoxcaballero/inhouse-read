import {getRustUI} from '../rust-ui.js'
import {neuralEngine} from './neural-runtime.js'
import {LegacyVoiceAhead} from './voice-ahead-legacy.js'
const legacy=LegacyVoiceAhead.prototype
export function prepareVoiceAhead(host){const ui=getRustUI();return ui?.voice_prepare_ahead?ui.voice_prepare_ahead(host,(owner,request)=>()=>ui.voice_ahead_active(owner,request),neuralEngine):legacy.prepareAhead.call(host)}
export function clearVoiceAhead(host){const ui=getRustUI();return ui?.voice_clear_ahead?ui.voice_clear_ahead(host):legacy.clearAhead.call(host)}
export function voicePageValid(plan){const ui=getRustUI();return ui?.voice_page_valid?ui.voice_page_valid(plan):legacy.pagePlanValid(plan)}
export async function revalidateVoiceNext(host,plan,generation){const ui=getRustUI();return ui?.voice_revalidate_next?ui.voice_revalidate_next(host,plan,generation):legacy.revalidateNext.call(host,plan,generation)}
export function adoptVoicePlan(host,plan){const ui=getRustUI();return ui?.voice_adopt_plan?ui.voice_adopt_plan(host,plan):legacy.adopt.call(host,plan)}
