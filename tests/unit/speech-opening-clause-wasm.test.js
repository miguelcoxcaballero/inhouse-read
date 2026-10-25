import { expect, it } from 'vitest'
import { rustUI } from './helpers/rust-ui-ready.js'
import { clause, units, properties, cjk } from '../../src/js/readers/speech-plan.js'
import { letters } from '../../src/js/readers/speech-pipeline.js'

// Frozen pre-migration expression; includes the browser's exact Unicode and
// UTF-16 matching rules independently of the native scan.
const reference = (text, a, b) => [...text.slice(a, b).matchAll(/[,;:—–،、，；：](?:\s+|(?=[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]))/gu)]
  .map(match => a + match.index + match[0].length)
  .find(at => at - a >= 24 && at - a <= 90 && b - at >= 24)

it('keeps opening cuts exact at length boundaries and for Unicode scripts', () => {
  for (const before of [0, 22, 23, 24, 88, 89, 90, 91, 120]) {
    for (const tail of [' ', '\r\n', '\u00a0', '\ufeff', '漢', 'あ', 'ア', '𠀀', '🙂', '\ud800']) {
      for (const after of [0, 23, 24, 25, 100]) {
        const text = 'x'.repeat(before) + ',' + tail + 'y'.repeat(after)
        expect(clause(text, 0, text.length, rustUI)).toBe(reference(text, 0, text.length))
      }
    }
  }
})

it('matches thousands of sliced paragraphs with multiple candidate marks', () => {
  const parts = ['a', 'word ', ', ', ';', '：', '漢', 'あ', 'ア', '𠀀', '\n', '\u2003', '— ', '🙂', '\ud800', '\udc00', '、', '\ufeff', ':\t']
  let seed = 41973
  const random = n => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % n }
  for (let round = 0; round < 4000; round++) {
    const text = Array.from({ length: random(200) }, () => parts[random(parts.length)]).join('')
    const a = random(text.length + 1), b = a + random(text.length + 40)
    expect(clause(text, a, b, rustUI)).toBe(reference(text, a, b))
  }
})

it('keeps the complete pipeline plan, page marks and normalized text identical', () => {
  for (const phrase of ['Words without punctuation ', 'A natural clause, followed by words ', '漢字、漢字。', 'あいう、えお。', 'Emoji 🙂 and words; more words ']) {
    for (const from of [0, 7, 51, 100]) {
      const raw = phrase.repeat(20) + '\u2029Next paragraph.'
      const invoke = native => {
        let text
        const packed = (native ? rustUI.speech_pipeline_native : rustUI.speech_pipeline)(units(raw), false, false, undefined,
          Float64Array.of(33, 100, 200), from, true, (a,b)=>units(raw.slice(a,b).toLocaleLowerCase()), letters,
          chars=>{text=String.fromCharCode(...chars)}, properties, (a,b)=>text.slice(a,b).toLocaleLowerCase(),
          native ? cjk : (a,b)=>reference(text,a,b))
        return { text, packed }
      }
      expect(invoke(true)).toEqual(invoke(false))
    }
  }
})
