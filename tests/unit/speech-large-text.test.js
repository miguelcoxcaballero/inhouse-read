// @vitest-environment node
import {it,expect,beforeAll,vi} from 'vitest'
import {readFileSync} from 'node:fs'
import * as ui from '../../src/wasm/ui/inhouse_read_ui.js'
import {sentenceEnds as referenceEnds} from './helpers/reference-sentence-ends.js'
import {planSpeech as referencePlan} from './helpers/reference-speech-plan.js'
import {normalizeSpeech,planSpeech} from '../../src/js/readers/speech-text.js'
import {sentenceEnds} from '../../src/js/readers/sentence-ends.js'
import {invoke as invokePlan} from '../helpers/speech-plan-cases.js'
import {invoke as invokeEnds} from '../helpers/sentence-ends-cases.js'

// Texts longer than one million UTF-16 units used to leave Rust (a 1 000 000 limit)
// for the JavaScript implementation. Rust answers them now; these tests hold it to
// the frozen original on texts well past the old limit, including surrogate pairs.
const fixture=vi.hoisted(()=>({ui:null}))
vi.mock('../../src/js/rust-ui.js',()=>({getRustUI:()=>fixture.ui}))
vi.mock('../../src/js/readers/sentence-ends.js',async()=>{
 const reference=(await import('./helpers/reference-sentence-ends.js')).sentenceEnds
 return {sentenceEnds:(...args)=>reference(...args)}
})
let core
beforeAll(()=>{core=ui.initSync({module:readFileSync('src/wasm/ui/inhouse_read_ui_bg.wasm')});fixture.ui=ui})
const bank=[
 'Sr. Gómez habló con la Dra. Núñez.','«¡Imposible!», dijo ella.','J. R. R. Tolkien escribió un libro.','Fig. 3: aparecen 3.5 casos.',
 '« Bonjour ! » dit-il.','Mr. Smith met Dr. Brown at 5 p.m. on Jan. 3rd.','中文句子。另一个！','Привет! Как дела?','Un nombre 𐐀. 𐐁 aparece.',
 'Una frase larga, con comas, punto y coma; dos puntos: y bastantes palabras para que se parta en fragmentos cortos pero más largos de lo habitual en un libro.',
 'Nota al pie[12] y otra (nota 4) incluidas.','informa-\ntion cortada.','1. Primera frase.','IV. Sección.','…y siguió.','\ud800 suelto.'
]
function corpus(length,seed){
 const joins=[' ',' ',' ','\n','\n\n',' ',' ']
 let state=seed;const next=n=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state%n}
 const parts=[];let size=0
 while(size<length){const part=bank[next(bank.length)]+joins[next(joins.length)];parts.push(part);size+=part.length}
 return parts.join('')
}
const text1=corpus(1_300_000,31),text2=corpus(2_300_000,77)
it('has texts beyond the old limit',()=>{expect(text1.length).toBeGreaterThan(1_000_000);expect(text2.length).toBeGreaterThan(2_000_000)})
for(const [name,text] of [['1.3 million',text1],['2.3 million',text2]]){
 it('finds the same sentence ends in a text of '+name+' units, with and without hard breaks',()=>{
  const breaks=[];for(let at=4999;at<text.length;at+=5003)breaks.push(at)
  for(const supplied of [[],breaks]){
   const expected=referenceEnds(text,supplied),actual=invokeEnds(ui,text,supplied)
   expect(actual.length).toBe(expected.length);expect(actual).toEqual(expected)
   expect(sentenceEnds(text,supplied)).toEqual(expected)
  }
 },120000)
 it('plans the same fragments, raw offsets and page marks for a text of '+name+' units',()=>{
  const before=ui.ui_live_handles()
  for(const [options,from] of [[{footnotes:false},0],[{footnotes:true,opening:true,pageBreaks:[12_345,700_001,1_100_000]},250_000],[{footnotes:false,skipHeaders:true},999_999]]){
   const expected=referencePlan(text,options,from),normalized=normalizeSpeech(text,options)
   const direct=invokePlan(ui,normalized,options,from)
   expect(direct.length).toBe(expected.length);expect(direct).toEqual(expected)
   for(let i=1;i<direct.length;i+=997)expect(direct[i].sentence===direct[i-1].sentence).toBe(expected[i].sentence===expected[i-1].sentence)
   // The production entry point goes through the same Rust call.
   expect(planSpeech(text,options,from)).toEqual(expected)
  }
  expect(ui.ui_live_handles()).toBe(before)
 },240000)
}
it('keeps the bounds checks on the normalized map for any length',()=>{
 const properties=code=>code===46?0:1
 const call=(text,map,breaks=[])=>ui.speech_plan(Uint16Array.from(text),Uint32Array.from(map),Uint32Array.from(breaks),new Float64Array(),0,false,properties,()=>'',()=>undefined)
 expect(call([65,66],[1,0])).toBeUndefined();expect(call([65],[0],[9])).toBeUndefined()
 expect(core.memory.buffer.byteLength).toBeGreaterThan(0)
})
