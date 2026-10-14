// @vitest-environment node
import {it,expect,beforeAll,vi} from 'vitest'
import {readFileSync} from 'node:fs'
import * as ui from '../../src/wasm/ui/inhouse_read_ui.js'
import {planSpeech} from './helpers/reference-speech-plan.js'
import {makeCases,invoke} from '../helpers/speech-pipeline-cases.js'
// The oracle is the frozen JavaScript (reference-speech-plan.js over reference-speech-text.js), independent of Rust.
const cases=makeCases(),blocks=Math.ceil(cases.length/100);let core,retained,capacity,held,expected
beforeAll(()=>{core=ui.initSync({module:readFileSync('src/wasm/ui/inhouse_read_ui_bg.wasm')})})
function compare([raw,options,from]){
 const actual=invoke(ui,raw,options,from)
 expect(actual).not.toBeUndefined()
 const expected=planSpeech(raw,options,from);expect(actual).toEqual(expected)
 for(let i=1;i<actual.length;i++)expect(actual[i].sentence===actual[i-1].sentence).toBe(expected[i].sentence===expected[i-1].sentence)
}
it('proves callbacks are counted and released before checking zero',()=>{
 const before=ui.ui_live_handles(),control=new ui.RustReadingProgressQueue(()=>{},()=>{},()=>{})
 try{expect(ui.ui_live_handles()).toBeGreaterThan(before)}finally{control.free()}
 expect(ui.ui_live_handles()).toBe(before)
 const text='The first sentence, including a marker[12], goes here. Another one.'
 held=invoke(ui,text,{footnotes:false,pageBreaks:[25]});expected=planSpeech(text,{footnotes:false,pageBreaks:[25]})
})
for(let block=0;block<blocks;block++)it('preserves the complete raw-to-plan result: block '+block,()=>{
 for(const args of cases.slice(block*100,(block+1)*100))compare(args)
 if(block===blocks-1){retained=ui.ui_live_handles();capacity=core.memory.buffer.byteLength}
})
for(let block=0;block<blocks;block++)it('keeps buffers, callbacks and prior plans independent: block '+block,()=>{
 for(const args of cases.slice(block*100,(block+1)*100))compare(args)
 expect(ui.ui_live_handles()).toBe(retained);expect(core.memory.buffer.byteLength).toBe(capacity);expect(held).toEqual(expected)
})
it('answers texts beyond a million code units, like the original',()=>{
 const text=('Una frase de prueba, con una coma; y otra más. '.repeat(24000)).slice(0,1_050_001)
 expect(text.length).toBeGreaterThan(1_000_000)
 expect(invoke(ui,text,{footnotes:false},500_000)).toEqual(planSpeech(text,{footnotes:false},500_000))
 expect(invoke(ui,'a'.repeat(1_000_001))).toEqual(planSpeech('a'.repeat(1_000_001)))
})
