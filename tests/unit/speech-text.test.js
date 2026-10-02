import { describe, it, expect } from 'vitest'
import { normalizeSpeech, planSpeech, speechChunks, speechSentences } from '../../src/js/readers/speech-text.js'

const split = text => speechSentences(text).map(sentence => text.slice(sentence.start, sentence.end))

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
