import {getRustUI} from '../rust-ui.js'
import {LegacyAdvance} from './voice-advance-legacy.js'
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))
export async function advanceVoice(host){const ui=getRustUI();return ui?.voice_advance?ui.voice_advance(host,(owner,generation)=>()=>ui.voice_advance_active(owner,generation),sleep):LegacyAdvance.prototype.advance.call(host)}
