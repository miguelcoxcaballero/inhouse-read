// @vitest-environment node
import {readFileSync} from 'node:fs'
import {it,expect,beforeAll,afterEach,vi} from 'vitest'
const state=vi.hoisted(()=>({core:null}))
vi.mock('../../src/js/rust-core.js',()=>({getRustCore:()=>state.core}))
import {normalizeReadingPreferences,readingCSS,nearestRate} from '../../src/js/readers/reading-preferences.js'
import * as reference from './helpers/reference-reading-preferences.js'
import {rustReadingNumbers,rustReadingCSS} from '../../src/js/readers/reading-preferences-wasm.js'
let core
beforeAll(async()=>{core=(await WebAssembly.instantiate(readFileSync('src/wasm/inhouse_read_core.wasm'))).instance.exports;state.core=core;expect(typeof core.reader_css).toBe('function')})
afterEach(()=>{state.core=core})
it('preserves every numeric setting, coercion, fallback, clamp and tie in nearest speed',()=>{
 const values=[undefined,null,'',false,true,0,-0,NaN,Infinity,-Infinity,-500,0.75,1,1.125,1.375,1.75,1.9999,14,36,64,400,500,600,1000000,'18','  ','1.5',[],[20],{},'broken']
 for(const value of values){
  const input=Object.fromEntries(['fontSize','lineHeight','margin','zoom','rate','brightness','fontWeight'].map(key=>[key,value]))
  expect(normalizeReadingPreferences(input)).toEqual(reference.normalizeReadingPreferences(input))
  expect(nearestRate(value)).toBe(reference.nearestRate(value))
 }
 for(const value of [null,0,[],false,'bad'])expect(normalizeReadingPreferences(value)).toEqual(reference.normalizeReadingPreferences(value))
})
it('preserves installed voice IDs, language choices, boolean options and theme/font selectors',()=>{
 for(const input of [{voice:'supertonic3:F1:es',voiceLang:'es-AR'}, {voice:'piper:en_US-lessac-medium',voiceLang:'en'}, {voice:'device:old',voiceLang:'xx'},
  {theme:'__proto__',font:'constructor',footnotes:1,multilingual:'false',skipHeaders:[]},{theme:'night',font:'sans',flow:'scrolled',pdfMode:'text',align:'justify'}]){
  expect(normalizeReadingPreferences(input)).toEqual(reference.normalizeReadingPreferences(input))
 }
})
it('produces exactly the original CSS for every theme, font and alignment with fractional sizes',()=>{
 let seed=7819;const random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296)
 for(const theme of Object.keys(reference.READING_THEMES))for(const font of Object.keys(reference.READING_FONTS))for(const align of ['start','justify'])for(let i=0;i<25;i++){
  const input={theme,font,align,fontSize:14+random()*22,lineHeight:1.2+random()*1.2,fontWeight:[400,500,600][i%3]}
  expect(readingCSS(input)).toBe(reference.readingCSS(input))
 }
})
it('uses both production exports and retains its arena size across repeated panel edits',()=>{
 const normalize=vi.fn(core.reader_preferences),css=vi.fn(core.reader_css),free=vi.fn(core.free_f64)
 state.core={...core,reader_preferences:normalize,reader_css:css,free_f64:free}
 readingCSS({theme:'amoled'});const capacity=core.memory.buffer.byteLength
 for(let i=0;i<1000;i++)readingCSS({fontSize:14+i%23})
 expect(normalize).toHaveBeenCalledTimes(1001);expect(css).toHaveBeenCalledTimes(24);expect(free).toHaveBeenCalledTimes(1025)
 expect(core.memory.buffer.byteLength).toBe(capacity)
})
it('bounds decoded style retention and includes every rendered field in the key',()=>{
 const css=vi.fn(core.reader_css);state.core={...core,reader_css:css}
 for(let i=0;i<100;i++){const input={fontSize:14+i/10,lineHeight:1.8};expect(readingCSS(input)).toBe(reference.readingCSS(input))}
 const count=css.mock.calls.length
 readingCSS({fontSize:14,lineHeight:1.8});expect(css).toHaveBeenCalledTimes(count+1)
 for(const input of [{theme:'sepia'},{font:'mono'},{fontSize:24},{fontWeight:600},{lineHeight:2},{align:'justify'}])expect(readingCSS(input)).toBe(reference.readingCSS(input))
})
it('preserves the original path on cold, old or failed modules',()=>{
 for(const candidate of [null,{}, {...core,alloc_f64:()=>0}, {...core,reader_preferences:()=>0,reader_css:()=>0}]){
  state.core=candidate
  expect(normalizeReadingPreferences({fontSize:28,rate:1.6})).toEqual(reference.normalizeReadingPreferences({fontSize:28,rate:1.6}))
  expect(readingCSS({theme:'night',font:'mono'})).toBe(reference.readingCSS({theme:'night',font:'mono'}))
 }
 state.core=core;expect(rustReadingCSS({theme:'bad',font:'bad'})).toBe(null)
 expect(core.reader_preferences(0)).toBe(0);expect(core.reader_css(0,0,0,0,0,0)).toBe(0)
})
