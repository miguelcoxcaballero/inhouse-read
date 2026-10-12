import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import {readFileSync} from 'node:fs'
import * as rustUI from '../../src/wasm/ui/inhouse_read_ui.js'
import { normalizeSpeech, planSpeech, speechChunks, speechSentences } from '../../src/js/readers/speech-text.js'

const split = text => speechSentences(text).map(sentence => text.slice(sentence.start, sentence.end))

const runtime=vi.hoisted(()=>({ui:null}));let boundaries=0,plans=0,pipelines=0
vi.mock('../../src/js/rust-ui.js',()=>({getRustUI:()=>runtime.ui}))
const observedUI={...rustUI,speech_pipeline:(...args)=>{pipelines++;return rustUI.speech_pipeline(...args)},speech_plan:(...args)=>{plans++;return rustUI.speech_plan(...args)},speech_sentence_ends:(...args)=>{boundaries++;return rustUI.speech_sentence_ends(...args)}}
beforeAll(()=>rustUI.initSync({module:readFileSync('src/wasm/ui/inhouse_read_ui_bg.wasm')}))
afterAll(()=>{expect(boundaries).toBeGreaterThan(0);expect(plans).toBeGreaterThan(0);expect(pipelines).toBeGreaterThan(0)})
describe.each(['legacy','rust','pipeline'])('speech text through %s',engine=>{
beforeEach(()=>{runtime.ui=engine==='pipeline'?observedUI:engine==='rust'?{...observedUI,speech_pipeline:undefined}:null})
describe('sentence boundaries', () => {
  it('does not split Spanish abbreviations, decimals, initials and "etc."', () => {
    expect(split('El Sr. Gómez llegó a las 3.5 horas, según la Dra. Pérez, etc. Había leído p. ej. sobre las EE. UU. y sobre J. R. R. Tolkien; nadie lo creyó... ¿Cómo iba a hacerlo? ¡Imposible!')).toEqual([
      'El Sr. Gómez llegó a las 3.5 horas, según la Dra. Pérez, etc.',
      'Había leído p. ej. sobre las EE. UU. y sobre J. R. R. Tolkien; nadie lo creyó...',
      '¿Cómo iba a hacerlo?', '¡Imposible!'])
    expect(split('Ver pág. 12 y fig. 3. Compró 10.30 kg. Luego se fue.')).toEqual(['Ver pág. 12 y fig. 3.', 'Compró 10.30 kg.', 'Luego se fue.'])
  })
  it('keeps English titles, initials, months and prices whole', () => {
    expect(split('Mr. Smith met Dr. J. K. Brown at 5 p.m. on Jan. 3rd, i.e. the day after the U.S. holiday. He paid $3.50 for the ticket, e.g. a bargain. Nobody cared.')).toEqual([
      'Mr. Smith met Dr. J. K. Brown at 5 p.m. on Jan. 3rd, i.e. the day after the U.S. holiday.',
      'He paid $3.50 for the ticket, e.g. a bargain.', 'Nobody cared.'])
  })
  it('keeps French guillemets and their dialogue tag with the sentence', () => {
    expect(split('M. Dupont est arrivé à 10 h 30. « Bonjour, Mme Martin ! » dit-il. « Comment allez-vous ? » Elle a répondu : « Très bien, merci. » Il y avait env. 3,5 km, c.-à-d. une heure.')).toEqual([
      'M. Dupont est arrivé à 10 h 30.', '« Bonjour, Mme Martin ! » dit-il.', '« Comment allez-vous ? »',
      'Elle a répondu : « Très bien, merci. »', 'Il y avait env. 3,5 km, c.-à-d. une heure.'])
  })
  it('Spanish dialogue: a turn ends at its full stop, but a dialogue tag after ? or ! stays with it', () => {
    expect(split('—Hola —dijo Ana—. Vamos a llegar tarde. —¿Vienes? —preguntó Luis. —Sí.')).toEqual(['—Hola —dijo Ana—.', 'Vamos a llegar tarde.', '—¿Vienes? —preguntó Luis.', '—Sí.'])
    expect(split('“Is it true?” she asked. “It is,” he said.')).toEqual(['“Is it true?” she asked.', '“It is,” he said.'])
  })
  it('a list number is not a sentence of its own, an ellipsis before a capital is', () => {
    expect(split('1. Primer punto. 2. Segundo punto.')).toEqual(['1. Primer punto.', '2. Segundo punto.'])
    expect(split('Esperó... Nadie vino... pero siguió allí.')).toEqual(['Esperó...', 'Nadie vino... pero siguió allí.'])
  })
  it('still ends sentences the way it always did', () => {
    expect(split('First one. Second one?  Third!')).toEqual(['First one.', 'Second one?', 'Third!'])
    expect(split('No terminator at the end')).toEqual(['No terminator at the end'])
    expect(split('Dijo: "Voy." Otro.')).toEqual(['Dijo: "Voy."', 'Otro.'])
  })
  it('knows the terminators of other scripts', () => {
    expect(split('これは最初の文です。二番目の文！本当ですか？はい。')).toEqual(['これは最初の文です。', '二番目の文！', '本当ですか？', 'はい。'])
    expect(split('هذه جملة أولى. هل هذه جملة ثانية؟ نعم!')).toEqual(['هذه جملة أولى.', 'هل هذه جملة ثانية؟', 'نعم!'])
  })
  it('a heading, list item or cell ends the sentence even when it looks like an initial', () => {
    const { text, breaks } = normalizeSpeech('Uno A B Texto.')
    expect(text).toBe('Uno. A. B. Texto.')
    expect(speechSentences(text, breaks).map(s => text.slice(s.start, s.end))).toEqual(['Uno.', 'A.', 'B.', 'Texto.'])
    const heading = normalizeSpeech('Capítulo 1: Empieza aquí.')
    expect(speechSentences(heading.text, heading.breaks).map(s => heading.text.slice(s.start, s.end))).toEqual(['Capítulo 1:', 'Empieza aquí.'])
  })
  it('planSpeech maps abbreviation-rich sentences back to raw offsets', () => {
    const raw = 'El Sr. Gómez vino. La Dra. Pérez no.'
    const items = planSpeech(raw)
    expect(items.map(item => item.text)).toEqual(['El Sr. Gómez vino.', 'La Dra. Pérez no.'])
    expect(raw.slice(items[1].sentence.start, items[1].sentence.end)).toBe('La Dra. Pérez no.')
  })
})

describe('spoken fragments', () => {
  const long = 'Una frase larga que atraviesa varias líneas del texto y que termina justo aquí, para que podamos ver cómo se parte el resaltado entre dos páginas de la columna cuando el libro se reparte.'
  it('cuts evenly at a clause mark, never leaving a one-word orphan', () => {
    const [sentence] = speechSentences(long)
    expect(sentence.fragments.map(f => f.text)).toEqual([
      'Una frase larga que atraviesa varias líneas del texto y que termina justo aquí,',
      'para que podamos ver cómo se parte el resaltado entre dos páginas de la columna cuando el libro se reparte.'])
  })
  it('every fragment fits 180 characters and together they rebuild the sentence', () => {
    for (const text of [long, `${'word '.repeat(80)}end.`, `${'x'.repeat(400)}.`, `${'palabra, '.repeat(60)}fin.`]) {
      const [sentence] = speechSentences(text)
      expect(sentence.fragments.every(f => f.text.length <= 180 && f.text === f.text.trim())).toBe(true)
      expect(sentence.fragments.map(f => f.text).join('').replace(/\s+/g, '')).toBe(text.replace(/\s+/g, ''))
      if (sentence.fragments.length > 2) expect(Math.min(...sentence.fragments.map(f => f.text.length))).toBeGreaterThan(40)
    }
  })
  it('speechChunks keeps its contract on plain text', () => {
    expect(speechChunks('Uno.  Dos?\nTres!')).toEqual(['Uno.', 'Dos?', 'Tres!'])
  })
})


describe('opening clause latency without lost text', () => {
  const raw='Cuando el reloj marcó la medianoche, el viejo bibliotecario cerró el último libro, apagó la lámpara y salió despacio.'
  it('prepares a complete short clause first and preserves every word and sentence highlight', () => {
    const original=planSpeech(raw),fast=planSpeech(raw,{opening:true})
    expect(original).toHaveLength(1)
    expect(fast).toHaveLength(2)
    expect(fast[0].text).toBe('Cuando el reloj marcó la medianoche,')
    expect(fast.map(x=>x.text).join(' ')).toBe(raw)
    for(const item of fast){expect(raw.slice(item.start,item.end)).toBe(item.text);expect(item.sentence).toEqual(original[0].sentence)}
  })
  it('retains normalization mappings and exact page boundaries', () => {
    const text=raw.replace('medianoche','media-\nnoche').replace('bibliotecario','[17] bibliotecario'),cut=text.indexOf('último')
    const items=planSpeech(text,{opening:true,footnotes:false,pageBreaks:[cut]})
    expect(items.map(x=>x.text).join(' ')).toBe(raw)
    expect(items.some(item=>item.marks?.some(mark=>mark.start===cut))).toBe(true)
    expect(items.some(item=>item.start<cut&&item.end>cut)).toBe(true)
    expect(items.at(-1).end).toBe(text.length)
  })
  it('only changes the first fragment, and never invents a mid-word or mid-clause break', () => {
    expect(planSpeech('Un título.',{opening:true})).toEqual(planSpeech('Un título.'))
    const unpunctuated='Los habitantes de aquel pueblo recordaban todas las historias del viejo bibliotecario y escuchaban sus relatos durante muchas horas.'
    expect(planSpeech(unpunctuated,{opening:true})).toEqual(planSpeech(unpunctuated))
    expect(planSpeech('Un título. '+raw,{opening:true})).toEqual(planSpeech('Un título. '+raw))
    const items=planSpeech(raw+' '+raw,{opening:true})
    expect(items).toHaveLength(3)
    expect(items[2].text).toBe(raw)
  })
  it('respects the saved starting offset', () => {
    const prefix='Página ya escuchada. ',text=prefix+raw
    const items=planSpeech(text,{opening:true},prefix.length)
    expect(items[0].start).toBe(prefix.length)
    expect(items.map(x=>x.text).join(' ')).toBe(raw)
    expect(items.every(x=>x.sentence.start===prefix.length)).toBe(true)
  })
})

})
