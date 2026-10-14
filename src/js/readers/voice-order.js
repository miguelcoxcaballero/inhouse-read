import {readerUI} from './rust-ui-required.js'
import {normalizeLang,languageName} from './voice-catalog.js'
const collator=(a,b,spanish)=>spanish?a.localeCompare(b,'es'):a.localeCompare(b)
const list=voices=>Array.isArray(voices)?voices:[...(voices||[])]
// The catalogue only holds records produced by normalizeNeuralVoice. Rust leaves
// anything else unanswered (undefined) instead of coercing it.
const answer=result=>{if(result===undefined)throw new TypeError('Unsupported neural voice record');return result}
export function orderNeuralVoices(voices,{bookLang='',deviceLang=''}={}){
 return answer(readerUI().voice_order(list(voices),bookLang,deviceLang,normalizeLang,languageName,collator))
}
export function recommendedNeuralFor(voices,lang,deviceLang=''){
 return answer(readerUI().voice_recommended(list(voices),lang,deviceLang,normalizeLang,languageName,collator))
}
