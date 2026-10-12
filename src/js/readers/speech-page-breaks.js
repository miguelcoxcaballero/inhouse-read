import {getRustUI} from '../rust-ui.js'
import {yieldToMessages} from './neural-voice/task-yield.js'
import {speechPageBreaks as legacySpeechPageBreaks} from './speech-page-breaks-legacy.js'

// Rust measures the same glyph ranges. Yield/cancellation and DOM range
// ownership stay tied to the open document; no timer estimates audio position.
export async function speechPageBreaks(map,renderer,{isCurrent=()=>true}={}) {
  const Scanner=getRustUI()?.RustSpeechPages
  if(!Scanner) return legacySpeechPageBreaks(map,renderer,{isCurrent})
  const scanner=new Scanner(map,renderer,isCurrent)
  try {
    while(!scanner.step()) await yieldToMessages()
    return scanner.result()
  } finally { scanner.free() }
}
