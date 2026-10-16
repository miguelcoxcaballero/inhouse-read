// @vitest-environment node
import {expect,it} from 'vitest'
import {rustUI as ui} from './helpers/rust-ui-ready.js'
import {neuralVoices} from '../../src/js/readers/neural-voice/catalog.js'
const units=text=>Uint16Array.from({length:text.length},(_,i)=>text.charCodeAt(i))
const spoken=(text,lang)=>ui.speech_spoken_numbers(units(text),lang)
it.each([
 ['es-ES','1999','mil novecientos noventa y nueve'],['es-MX','2026','dos mil veintiséis'],
 ['en-US','1999','one thousand, nine hundred and ninety-nine'],['fr-FR','2026','deux mille vingt-six'],
 ['de-DE','2026','zweitausendsechsundzwanzig'],['it-IT','2026','duemilaventisei'],
 ['pt-BR','2026','dois mil e vinte e seis'],['ca-ES','2026','dos mil vint-i-sis'],
])('spells years in the selected voice language: %s %s',(lang,n,expected)=>{
 expect(spoken(n,lang)).toBe(expected)
})
it('converts a year in every language offered by the voice catalogue',()=>{
 for(const lang of new Set(neuralVoices.map(voice=>voice.lang))){
  const result=spoken('2026',lang)
  expect(result,lang).not.toMatch(/[0-9]/)
  expect(result.trim().length,lang).toBeGreaterThan(0)
 }
})
it('spells representative historical years and century boundaries in every catalogue language',()=>{
 for(const lang of new Set(neuralVoices.map(voice=>voice.lang)))for(const year of ['0','1','42','99','100','101','999','1000','1066','1492','1900','1901','1914','1945','1999','2000','2001','2010','2020','2026','2100','9999']){
  const result=spoken(year,lang)
  expect(result,`${lang}/${year}`).not.toMatch(/[0-9]/)
  expect(result.trim().length,`${lang}/${year}`).toBeGreaterThan(0)
 }
})
it('keeps UTF-16 and nonnumeric content, identifiers and decimal punctuation unchanged',()=>{
 for(const text of ['hola 😀 \ud800 \udfff','ISBN978123','v2.1','x12','https://a.test/1.2','3,14 y 2.5','Artículo IV.'])expect(spoken(text,'es')).toBe(text)
 expect(spoken('En 1999, luego 2026.','es')).toBe('En mil novecientos noventa y nueve, luego dos mil veintiséis.')
 expect(spoken('2026','xx-XX')).toBe('2026')
 expect(spoken('٢٠٢٦','ar')).not.toMatch(/[0-9٠-٩]/)
 expect(spoken('२०२६','hi')).not.toMatch(/[0-9०-९]/)
 expect(spoken('03','es')).toBe('cero tres')
})
it('remaps synthesis page marks while retaining original queue text and UTF-16 coordinates',()=>{
 const raw='En 1999 llegamos. En 2026 volvemos.'
 const marker=raw.indexOf('En 2026'), before=raw.slice(0,marker)
 const prepared=ui.speech_synthesis_text(raw,'es-ES',[marker,raw.length])
 expect(prepared.text).toBe(spoken(raw,'es-ES'))
 expect(prepared.marks).toEqual([spoken(before,'es-ES').length,prepared.text.length])
 expect(prepared.offsetPairs).toEqual([[prepared.marks[0],marker],[prepared.marks[1],raw.length]])
 expect(raw).toBe('En 1999 llegamos. En 2026 volvemos.')
})

it('expands CJK years without spaces and retains all source marks when a number becomes shorter',()=>{
 expect(spoken('2026年','zh-CN')).toBe('二千零二十六年')
 expect(spoken('2026年','ja')).toBe('二千二十六年')
 const prepared=ui.speech_synthesis_text('100000000之后。','zh-CN',[1,2,5,8])
 expect(prepared.text).toBe('一亿之后。')
 expect(new Set(prepared.marks).size).toBe(prepared.marks.length)
 expect(prepared.offsetPairs.map(pair=>pair[1])).toEqual([1,2,5,8])
})

it.each([
 ['In 1969, we landed.','In nineteen sixty-nine, we landed.'],
 ['Since 1901.','Since nineteen oh-one.'],
 ['The year 1900.','The year nineteen hundred.'],
 ['In 2000.','In two thousand.'],
 ['In 2001.','In two thousand and one.'],
 ['In 2026.','In twenty twenty-six.'],
 ['July 20, 1969.','July twenty, nineteen sixty-nine.'],
 ['1969 was remarkable.','nineteen sixty-nine was remarkable.'],
 ['From the year 1969–1972.','From the year nineteen sixty-nine–nineteen seventy-two.'],
 ['We printed 1969 books.','We printed one thousand, nine hundred and sixty-nine books.'],
 ['In 1969 books we found it.','In one thousand, nine hundred and sixty-nine books we found it.'],
 ['It cost $1969.','It cost $one thousand, nine hundred and sixty-nine.'],
 ['1969','one thousand, nine hundred and sixty-nine'],
])('distinguishes dates from quantities: %s',(source,expected)=>expect(spoken(source,'en-US')).toBe(expected))
it('keeps original year offsets while expanding the wire text',()=>{
 const source='In 1969, we read 1969 books.';
 const at=source.indexOf('we');
 const result=ui.speech_synthesis_text(source,'en-GB',[at,source.length]);
 expect(result.text).toBe('In nineteen sixty-nine, we read one thousand, nine hundred and sixty-nine books.');
 expect(result.offsetPairs).toEqual([[result.text.indexOf('we'),at],[result.text.length,source.length]]);
 expect(spoken('En 1969.','es-ES')).toBe('En mil novecientos sesenta y nueve.');
})
