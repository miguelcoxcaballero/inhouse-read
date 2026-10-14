import {readerUI} from './rust-ui-required.js'
import {properties,units} from './speech-plan.js'
// Rust answers any length. It leaves boundaries it cannot trust (not integers inside the text)
// unanswered instead of coercing them; the normalizer never produces such a list.
export function sentenceEnds(text,breaks=[]){
 const result=readerUI().speech_sentence_ends(units(text),breaks,properties,(a,b)=>text.slice(a,b).toLocaleLowerCase())
 if(result===undefined)throw new TypeError('Unsupported sentence boundaries')
 return result
}
