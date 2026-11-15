// Test harness: the single steps of the audiobook's text pipeline as src/js/readers/speech-text.js exported them. The
// reader only asks for a whole plan (planSpeech) and for the first sentence of a page; these call the same rust-ui
// kernels one step at a time, for the tests that pin each step against tests/unit/helpers/reference-speech-text.js.
import {ranges,letters,decodeUnits} from '../../../src/js/readers/speech-pipeline.js'
import {readerUI} from '../../../src/js/readers/rust-ui-required.js'
import {units,properties} from '../../../src/js/readers/speech-plan.js'
export * from '../../../src/js/readers/speech-text.js'

// speech-map.js puts this between blocks that must not run into each other (see HARD_BLOCKS there).
export const HARD_BREAK = String.fromCharCode(0x2029)

/** Drops what must not be read, keeping raw offsets: returns { text, map, breaks } with map[i] = raw offset of text[i]. */
export function normalizeSpeech(raw, { footnotes = true, skipHeaders = false, headerRanges } = {}) {
  raw = String(raw || '')
  let text
  const packed = readerUI().speech_normalized(units(raw), Boolean(footnotes), Boolean(skipHeaders), skipHeaders ? ranges(headerRanges) : undefined,
    (a, b) => units(raw.slice(a, b).toLocaleLowerCase()), letters, chars => { text = decodeUnits(chars) })
  if (packed === undefined) throw new TypeError('Unsupported speech text')
  const size = packed[0]
  return { text, map: Array.from(packed.subarray(1, 1 + size)), breaks: Array.from(packed.subarray(1 + size)) }
}

/**
 * Sentences of an already normalised text; long ones also carry their <=180 character spoken fragments.
 * `breaks` are the places where a heading, list item or cell ends (normalizeSpeech reports them).
 * Evaluated against Intl.Segmenter: ICU does not know "Sr." or "J. K." either, glues "¡Imposible! —Hola —dijo Ana—." together and
 * splits « Bonjour ! » dit-il, so the splitter stays this one, with the abbreviation/initial/number rules in Rust.
 */
export function speechSentences(text, breaks = []) {
  text = String(text)
  const packed = readerUI().speech_sentences(units(text), breaks, properties, (a, b) => text.slice(a, b).toLocaleLowerCase())
  if (packed === undefined) throw new TypeError('Unsupported sentence boundaries')
  const sentences = []
  let sentence
  for (let at = 0; at < packed.length; at += 4) {
    if (!sentence || sentence.start !== packed[at]) sentences.push(sentence = { start: packed[at], end: packed[at + 1], fragments: [] })
    sentence.fragments.push({ start: packed[at + 2], end: packed[at + 3], text: text.slice(packed[at + 2], packed[at + 3]) })
  }
  return sentences
}

export const speechChunks = text => speechSentences(String(text || '').replace(/\s+/g, ' ').trim()).flatMap(s => s.fragments.map(f => f.text))
