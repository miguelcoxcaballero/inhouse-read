// Test harness: the text maps of src/js/readers/speech-map.js. The readers ask rust-ui for them (reader_doors.rs
// `speech_mapped`, which is what the module's `map` did: `speech_map`, then `speech_range` and `speech_offset` bound to
// the document and the spans); this is the same doorway under the names the tests and the frozen references use.
import {readerUI} from '../../../src/js/readers/rust-ui-required.js'
const map=(root,mode)=>{const ui=readerUI();return ui.speech_mapped(ui,mode,root)}
export const mapSpeechText=root=>map(root,0)
export const mapTextLayer=root=>map(root,1)
export const mapTextNode=node=>map(node,2)
export const mapTextNodes=root=>map(root,3)
