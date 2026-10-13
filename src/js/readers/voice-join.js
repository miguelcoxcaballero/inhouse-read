import {readerUI} from './rust-ui-required.js'
const add=(left,right)=>left+right
export function joinVoiceSentence(host){return readerUI().voice_join_sentence(host,add)}
