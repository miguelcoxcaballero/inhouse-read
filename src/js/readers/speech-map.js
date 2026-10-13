// DOM maps keep their original JavaScript nodes. Rust owns traversal and lookup;
// no persistent WASM handle needs a finalizer when a chapter is discarded.
import {readerUI} from './rust-ui-required.js'
function map(root,mode){
 const ui=readerUI()
 // A missing document or layer is a caller error: read the same property the
 // original traversal read first, so it fails with the same TypeError.
 if(!root&&mode<2)void root.ownerDocument
 const {text,spans,doc}=ui.speech_map(root,mode)
 return {text,spans,
  rangeFor:(start,end)=>ui.speech_range(doc,spans,start,end),
  offsetOf:(container,offset)=>ui.speech_offset(doc,spans,container,offset)}
}
export const mapSpeechText=root=>map(root,0)
export const mapTextLayer=root=>map(root,1)
export const mapTextNode=node=>map(node,2)
export const mapTextNodes=root=>map(root,3)
