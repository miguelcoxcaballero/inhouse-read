import {readerUI} from './rust-ui-required.js'
import {yieldToMessages} from './neural-voice/task-yield.js'

// Rust measures the same glyph ranges. Yield/cancellation and DOM range
// ownership stay tied to the open document; no timer estimates audio position.
export async function speechPageBreaks(map,renderer,{isCurrent=()=>true}={}) {
  const scanner=new (readerUI().RustSpeechPages)(map,renderer,isCurrent)
  try {
    while(!scanner.step()) await yieldToMessages()
    return scanner.result()
  } finally { scanner.free() }
}
