import {readerUI} from './rust-ui-required.js'
import {neuralEngine} from './neural-runtime.js'
export function prepareVoiceAhead(host){const ui=readerUI();return ui.voice_prepare_ahead(host,(owner,request)=>()=>ui.voice_ahead_active(owner,request),neuralEngine)}
export function clearVoiceAhead(host){return readerUI().voice_clear_ahead(host)}
export function voicePageValid(plan){return readerUI().voice_page_valid(plan)}
export async function revalidateVoiceNext(host,plan,generation){return readerUI().voice_revalidate_next(host,plan,generation)}
export function adoptVoicePlan(host,plan){return readerUI().voice_adopt_plan(host,plan)}
