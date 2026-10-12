import {getRustUI} from '../rust-ui.js'
import {normalizeLang,languageName} from './voice-catalog.js'
import {orderNeuralVoices as legacyOrder,recommendedNeuralFor as legacyRecommendation} from './voice-order-legacy.js'
const collator=(a,b,spanish)=>spanish?a.localeCompare(b,'es'):a.localeCompare(b)
export function orderNeuralVoices(voices,{bookLang='',deviceLang=''}={}){
 const ui=getRustUI(),result=ui?.voice_order?.(voices,bookLang,deviceLang,normalizeLang,languageName,collator)
 return result===undefined?legacyOrder(voices,{bookLang,deviceLang}):result
}
export function recommendedNeuralFor(voices,lang,deviceLang=''){
 const ui=getRustUI(),result=ui?.voice_recommended?.(voices,lang,deviceLang,normalizeLang,languageName,collator)
 return result===undefined?legacyRecommendation(voices,lang,deviceLang):result
}
