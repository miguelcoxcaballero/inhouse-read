import {readerUI} from './rust-ui-required.js'
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))
export async function advanceVoice(host){const ui=readerUI();return ui.voice_advance(host,(owner,generation)=>()=>ui.voice_advance_active(owner,generation),sleep)}
