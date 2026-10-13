// @vitest-environment node
import {it,expect,beforeAll} from 'vitest'
import {readFileSync} from 'node:fs'
import * as ui from '../../src/wasm/ui/inhouse_read_ui.js'
import {orderNeuralVoices,recommendedNeuralFor} from './helpers/reference-voice-order.js'
import {normalizeLang,languageName,normalizeNeuralVoice} from '../../src/js/readers/voice-catalog.js'
import {neuralVoices} from '../../src/js/readers/neural-voice/catalog.js'
import {makeCases,collator} from '../helpers/voice-order-cases.js'
let core,retained,capacity
beforeAll(()=>{core=ui.initSync({module:readFileSync('src/wasm/ui/inhouse_read_ui_bg.wasm')})})
const native=(voices,book,device)=>ui.voice_order(voices,book,device,normalizeLang,languageName,collator)
const recommendation=(voices,book,device)=>ui.voice_recommended(voices,book,device,normalizeLang,languageName,collator)
const cases=makeCases()
function compare(voices,book,device){
 const expected=orderNeuralVoices(voices,{bookLang:book,deviceLang:device}),actual=native(voices,book,device)
 expect(actual.length).toBe(expected.length);actual.forEach((voice,i)=>expect(voice).toBe(expected[i]))
 expect(recommendation(voices,book,device)).toBe(recommendedNeuralFor(voices,book,device))
}
for(let block=0;block<16;block++)it('preserves object identity and order: block '+block,()=>{
 for(const args of cases.slice(block*100,(block+1)*100))compare(...args)
 if(block===15){retained=ui.ui_live_handles();capacity=core.memory.buffer.byteLength}
})
for(let block=0;block<16;block++)it('keeps bounded memory: block '+block,()=>{
 for(const args of cases.slice(block*100,(block+1)*100))compare(...args)
 expect(ui.ui_live_handles()).toBe(retained);expect(core.memory.buffer.byteLength).toBe(capacity)
})
it('returns compatibility marker for foreign records without coercion',()=>{
 for(const voices of [null,new Set(),[0],[false],['plain'],[{neural:true}],[{neural:true,base:'\ud800',region:'',recommended:false,id:'a',name:'a'}]]){
  expect(native(voices,'en','es')).toBeUndefined();expect(recommendation(voices,'en','es')).toBeUndefined()
 }
 expect(native([],'constructor','es')).toBeUndefined()
})
const catalogue=neuralVoices.map(entry=>normalizeNeuralVoice(entry)).filter(Boolean)
for(const lang of new Set(catalogue.flatMap(voice=>[voice.lang,voice.base])))it('preserves the complete shipped catalogue for '+lang,()=>{
 compare(catalogue,lang,'es-ES');compare([...catalogue].reverse(),lang,'en-US')
})
