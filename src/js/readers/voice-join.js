import {getRustUI} from '../rust-ui.js'
import {LegacyVoiceJoin} from './voice-join-legacy.js'
const add=(left,right)=>left+right
export function joinVoiceSentence(host){const ui=getRustUI();return ui?.voice_join_sentence?ui.voice_join_sentence(host,add):LegacyVoiceJoin.prototype.joinPageSentence.call(host)}
