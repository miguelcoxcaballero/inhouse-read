// @vitest-environment node
import {it,expect,beforeAll,vi} from 'vitest'
import {readFileSync} from 'node:fs'
import * as ui from '../../src/wasm/ui/inhouse_read_ui.js'
import {normalizeSpeech} from '../../src/js/readers/speech-text.js'
import {planSpeech} from '../../src/js/readers/speech-plan-legacy.js'
import {makeCases,invoke,properties} from '../helpers/speech-plan-cases.js'
vi.mock('../../src/js/rust-ui.js',()=>({getRustUI:()=>null}))
const cases=makeCases(),blocks=Math.ceil(cases.length/100);let core,retained,capacity
beforeAll(()=>{core=ui.initSync({module:readFileSync('src/wasm/ui/inhouse_read_ui_bg.wasm')})})
function compare([raw,options,from]){
 const expected=planSpeech(raw,options,from),actual=invoke(ui,normalizeSpeech(raw,options),options,from)
 expect(actual).toEqual(expected)
 for(let i=1;i<actual.length;i++)expect(actual[i].sentence===actual[i-1].sentence).toBe(expected[i].sentence===expected[i-1].sentence)
}
it('proves that retained callbacks are counted and released',()=>{
 const before=ui.ui_live_handles(),control=new ui.RustReadingProgressQueue(()=>{},()=>{},()=>{})
 try{expect(ui.ui_live_handles()).toBeGreaterThan(before)}finally{control.free()}
 expect(ui.ui_live_handles()).toBe(before)
})
for(let block=0;block<blocks;block++)it('preserves phrases, page marks, raw offsets and sentence identity: block '+block,()=>{
 for(const args of cases.slice(block*100,(block+1)*100))compare(args)
 if(block===blocks-1){retained=ui.ui_live_handles();capacity=core.memory.buffer.byteLength}
})
for(let block=0;block<blocks;block++)it('keeps native memory and references stable: block '+block,()=>{
 for(const args of cases.slice(block*100,(block+1)*100))compare(args)
 expect(ui.ui_live_handles()).toBe(retained);expect(core.memory.buffer.byteLength).toBe(capacity)
})
it('rejects invalid normalized maps and boundaries before indexing',()=>{
 const call=(text,map,breaks=[])=>ui.speech_plan(Uint16Array.from(text),Uint32Array.from(map),Uint32Array.from(breaks),new Float64Array(),0,false,properties,()=>'',()=>undefined)
 for(const [text,map,breaks]of [[[65],[]],[[65],[0],[2]],[[65,66],[2,1]],[[65],[0xffffffff]]])expect(call(text,map,breaks)).toBeUndefined()
})
