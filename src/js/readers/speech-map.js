// DOM maps keep their original JavaScript nodes. Rust owns traversal and lookup;
// no persistent WASM handle needs a finalizer when a chapter is discarded.
import {getRustUI} from '../rust-ui.js'
import * as legacy from './speech-map-legacy.js'
const names=['mapSpeechText','mapTextLayer','mapTextNode','mapTextNodes']
function map(root,mode){
 const ui=getRustUI()
 if(!ui?.speech_map||!ui.speech_range||!ui.speech_offset||(!root&&mode<2))return legacy[names[mode]](root)
 const {text,spans,doc}=ui.speech_map(root,mode)
 return {text,spans,
  rangeFor:(start,end)=>ui.speech_range(doc,spans,start,end),
  offsetOf:(container,offset)=>ui.speech_offset(doc,spans,container,offset)}
}
export const mapSpeechText=root=>map(root,0)
export const mapTextLayer=root=>map(root,1)
export const mapTextNode=node=>map(node,2)
export const mapTextNodes=root=>map(root,3)
