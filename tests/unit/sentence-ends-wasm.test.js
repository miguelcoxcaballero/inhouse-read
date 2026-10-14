// @vitest-environment node
import {it,expect,beforeAll} from 'vitest'
import {readFileSync} from 'node:fs'
import * as ui from '../../src/wasm/ui/inhouse_read_ui.js'
import {sentenceEnds} from './helpers/reference-sentence-ends.js'
import {makeCases,invoke} from '../helpers/sentence-ends-cases.js'
const cases=makeCases(),blocks=Math.ceil(cases.length/100);let core,retained,capacity
beforeAll(()=>{core=ui.initSync({module:readFileSync('src/wasm/ui/inhouse_read_ui_bg.wasm')})})
it('observes retained references and their release before certifying a zero baseline',()=>{
 const before=ui.ui_live_handles(),control=new ui.RustReadingProgressQueue(()=>{},()=>{},()=>{})
 try{expect(ui.ui_live_handles()).toBeGreaterThan(before)}finally{control.free()}
 expect(ui.ui_live_handles()).toBe(before)
})
for(let block=0;block<blocks;block++)it('preserves UTF16 boundaries: block '+block,()=>{
 for(const args of cases.slice(block*100,(block+1)*100))expect(invoke(ui,...args)).toEqual(sentenceEnds(...args))
 if(block===blocks-1){retained=ui.ui_live_handles();capacity=core.memory.buffer.byteLength}
})
for(let block=0;block<blocks;block++)it('keeps handles and memory bounded: block '+block,()=>{
 for(const args of cases.slice(block*100,(block+1)*100))expect(invoke(ui,...args)).toEqual(sentenceEnds(...args))
 expect(ui.ui_live_handles()).toBe(retained);expect(core.memory.buffer.byteLength).toBe(capacity)
})
it('leaves malformed supplied boundaries to compatibility without coercion',()=>{
 for(const breaks of [null,{},[-1],[Infinity],[NaN],[1.5],['2'],[99]])expect(invoke(ui,'hello.',breaks)).toBeUndefined()
})
