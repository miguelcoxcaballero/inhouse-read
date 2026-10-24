import {afterEach,describe,expect,it,vi} from 'vitest'
import {rustUI} from './helpers/rust-ui-ready.js'
import {rustShelf} from './helpers/rust-shelf-ready.js'
import {rustReadingNumbers} from '../../src/js/readers/reading-preferences-wasm.js'
import {READING_THEMES,READING_FONTS,normalizeReadingPreferences,readingCSS,nearestRate,rateLabel} from '../../src/js/readers/reading-preferences.js'
import {isNeuralVoiceId,neuralVoices} from '../../src/js/readers/neural-voice/catalog.js'
import {langBase} from '../../src/js/readers/voice-catalog.js'
import * as reference from './helpers/reference-reading-preferences.js'
import * as previous from './helpers/reference-reading-preferences-runtime.js'

const kit={themes:READING_THEMES,fonts:READING_FONTS,voices:neuralVoices,langBase,isVoice:isNeuralVoiceId,numbers:rustReadingNumbers}
const values=[undefined,null,'',false,true,0,-0,NaN,Infinity,-Infinity,-500,.75,1,1.125,1.375,1.75,1.9999,14,36,64,400,500,600,1e6,'18','  ','1.5',[],[20],{},'broken',2n]
afterEach(()=>vi.restoreAllMocks())
describe.each([['ui',rustUI],['shelf',rustShelf]])('reading preferences in %s',(domain,native)=>{
 it('preserves normalized values, coercions, clamping and nearest-rate ties',()=>{
  for(const value of values){
   const input=Object.fromEntries(['fontSize','lineHeight','margin','zoom','rate','brightness','fontWeight'].map(key=>[key,value]))
   expect(native.reading_preferences_normalize(input,kit)).toEqual(reference.normalizeReadingPreferences(input))
   expect(native.reading_preferences_rate(value)).toBe(reference.nearestRate(value))
  }
  for(const value of [null,undefined,0,[],false,'bad',()=>{},2n,Symbol()])expect(native.reading_preferences_normalize(value,kit)).toEqual(reference.normalizeReadingPreferences(value))
 })
 it('keeps exact voice/language, theme/font, enum and boolean decisions',()=>{
  for(const input of [{voice:'supertonic3:F1:es',voiceLang:'es-AR'},{voice:'piper:en_US-lessac-medium',voiceLang:'en'},
   {voice:'device:old',voiceLang:'xx'},{voice:Symbol(),voiceLang:[]},{voice:'\ud800',voiceLang:'\ud801'},
   {theme:'__proto__',font:'constructor',footnotes:1,multilingual:'false',skipHeaders:[]},
   {theme:'night',font:'sans',flow:'scrolled',pdfMode:'text',align:'justify'},{theme:new String('paper'),font:new String('book')},
   {theme:Symbol(),font:{toString:()=> 'mono'},fontWeight:'500'}]){
   expect(native.reading_preferences_normalize(input,kit)).toEqual(reference.normalizeReadingPreferences(input))
  }
 })
 it('reuses the exact shared CSS for all appearance choices and 1000 fractional configurations',()=>{
  let seed=7819;const random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296),cache=new Map()
  for(const theme of Object.keys(READING_THEMES))for(const font of Object.keys(READING_FONTS))for(const align of ['start','justify'])for(let n=0;n<25;n++){
   const input={theme,font,align,fontSize:14+random()*22,lineHeight:1.2+random()*1.2,fontWeight:[400,500,600][n%3]}
   expect(native.reading_preferences_css(input,kit,cache)).toBe(reference.readingCSS(input))
  }
  expect(cache.size).toBe(64)
 })
 it('keeps FIFO cache bounds and every rendered field in its key',()=>{
  const cache=new Map();let firstKey
  for(let n=0;n<100;n++){native.reading_preferences_css({fontSize:14+n/10,lineHeight:1.8},kit,cache);firstKey??=cache.keys().next().value}
  expect(cache.size).toBe(64);expect(cache.has(firstKey)).toBe(false)
  native.reading_preferences_css({fontSize:14,lineHeight:1.8},kit,cache);expect(cache.has(firstKey)).toBe(true)
  const before=[...cache.keys()];native.reading_preferences_css({fontSize:14,lineHeight:1.8,margin:0,rate:2,brightness:80},kit,cache);expect([...cache.keys()]).toEqual(before)
  for(const input of [{theme:'sepia'},{font:'mono'},{fontSize:24},{fontWeight:600},{lineHeight:2},{align:'justify'}])expect(native.reading_preferences_css(input,kit,cache)).toBe(reference.readingCSS(input))
 })
 it('preserves the fallback ordering when the numeric core rejects a getter',()=>{
  const outputs=[]
  for(const implementation of [previous.normalizeReadingPreferences,input=>native.reading_preferences_normalize(input,kit)]){
   const seen=[];let attempts=0
   const input={get fontSize(){seen.push('size');if(++attempts===1)throw Error('first attempt');return 21},get theme(){seen.push('theme');return 'night'},get voiceLang(){seen.push('lang');return 'es'},get fontWeight(){seen.push('weight');return 500}}
   outputs.push({result:implementation(input),seen})
  }
  expect(outputs[1]).toEqual(outputs[0])
 })
 it('uses the shared fallback for cold numeric cores without changing property order',()=>{
  const host={...kit,numbers:()=>null},outputs=[]
  for(const implementation of [reference.normalizeReadingPreferences,input=>native.reading_preferences_normalize(input,host)]){
   const seen=[];const input={get fontSize(){seen.push('size');return 21},get fontWeight(){seen.push('weight');return 500},get voice(){seen.push('voice');return ''},get theme(){seen.push('theme');return 'night'}}
   outputs.push({result:implementation(input),seen})
  }
  expect(outputs[1]).toEqual(outputs[0])
 })
 it('keeps custom property-key identity and dynamic CSS conversions',()=>{
  for(const theme of [new String('paper'),{toString:()=> 'night'}])for(const font of [new String('book'),{toString:()=> 'mono'}]){
   const input={theme,font,fontSize:21.5};const result=native.reading_preferences_normalize(input,kit)
   expect(result.theme).toBe(theme);expect(result.font).toBe(font)
   expect(native.reading_preferences_css(input,kit,new Map())).toBe(reference.readingCSS(input))
  }
 })
 it('preserves Unicode labels and conversion errors without retaining handles',()=>{
  for(const value of [1,1.25,'\ud800',Symbol('rate'),null,2n])expect(native.reading_preferences_rate_label(value)).toBe(reference.rateLabel(value))
  const failure=Error('bad conversion'),input={fontSize:{valueOf(){throw failure}}},counter=domain==='ui'?native.ui_live_handles:native.shelf_live_handles
  expect(()=>native.reading_preferences_normalize(input,kit)).toThrow(failure);const baseline=counter()
  for(let n=0;n<100;n++){
   expect(()=>native.reading_preferences_normalize(input,kit)).toThrow(failure)
   expect(()=>native.reading_preferences_rate(Symbol())).toThrow(TypeError)
   native.reading_preferences_css({fontSize:14+n%10},kit,new Map())
  }
  expect(counter()).toBe(baseline)
 })
})
it('adopts the real reader policy without loading voices or calling app-core CSS arenas',()=>{
 const fetch=vi.spyOn(globalThis,'fetch').mockImplementation(()=>{throw Error('unexpected fetch')})
 for(const input of [{theme:'amoled',fontSize:24,voiceLang:'es'},{font:'mono',flow:'scrolled'},{rate:1.8,voice:'piper:en_US-lessac-medium'}]){
  expect(normalizeReadingPreferences(input)).toEqual(reference.normalizeReadingPreferences(input));expect(readingCSS(input)).toBe(reference.readingCSS(input))
 }
 expect(nearestRate(1.125)).toBe(1);expect(rateLabel(1.25)).toBe('1,25×');expect(fetch).not.toHaveBeenCalled()
})
