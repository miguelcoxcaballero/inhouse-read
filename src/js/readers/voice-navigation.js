import {readerUI} from './rust-ui-required.js'
const add=(a,b)=>a+b
export function browseVoice(host){return readerUI().voice_browse(host,add)}
export async function returnVoiceAudio(host){return readerUI().voice_return_audio(host)}
export async function continueVoicePage(host,navigate){return readerUI().voice_continue_page(host,navigate)}
export function jumpVoicePoint(host,{doc,x,y}={}){return readerUI().voice_jump_point(host,doc,x,y)}
export async function seekVoicePoint(host,{doc,x,y}){return readerUI().voice_seek_point(host,doc,x,y)}
