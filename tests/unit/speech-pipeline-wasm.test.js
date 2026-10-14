// @vitest-environment node
import {it,expect,beforeAll,vi} from 'vitest'
import {readFileSync} from 'node:fs'
import * as ui from '../../src/wasm/ui/inhouse_read_ui.js'
import {planSpeech} from './helpers/reference-speech-plan.js'
import {makeCases,invoke} from '../helpers/speech-pipeline-cases.js'
vi.mock('../../src/js/rust-ui.js',()=>({getRustUI:()=>null}))
// The frozen JavaScript boundaries stand in for the production ones, so the oracle stays independent of Rust.
vi.mock('../../src/js/readers/sentence-ends.js',async()=>({sentenceEnds:(await import('./helpers/reference-sentence-ends.js')).sentenceEnds}))
const cases=makeCases(),blocks=Math.ceil(cases.length/100);let core,retained,capacity,held,expected
beforeAll(()=>{core=ui.initSync({module:readFileSync('src/wasm/ui/inhouse_read_ui_bg.wasm')})})
function compare([raw,options,from]){
 const actual=invoke(ui,raw,options,from)
 if(actual===undefined){expect(Boolean(options?.skipHeaders&&options?.headerRanges===undefined&&!String(raw).isWellFormed())).toBe(true);return}
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
it('bounds the native input size',()=>expect(invoke(ui,'a'.repeat(1_000_001))).toBeUndefined())
