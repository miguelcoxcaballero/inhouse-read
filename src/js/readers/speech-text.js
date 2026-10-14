import {rustSpeechPipeline,ranges,letters,decodeUnits} from './speech-pipeline.js'
import {readerUI} from './rust-ui-required.js'
import {units,properties} from './speech-plan.js'

// Pure text side of the audiobook: turn the raw text a reader exposes into
// sentences and spoken fragments WITHOUT losing where each one came from. The
// reading highlight needs "sentence 7 is raw[1203, 1290)", so every cleanup
// (footnote markers, collapsed whitespace, soft hyphens, repeated headers)
// keeps an index map from the cleaned text back to the raw text.
// All of it is rust-ui (speech_mask.rs, speech_normalize, sentence_ends.rs, speech_fragments, speech_plan.rs); the frozen
// JavaScript original is tests/unit/helpers/reference-speech-text.js. Locale-dependent case folding and Unicode properties
// are the browser's and come in as callbacks.

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

/**
 * Spoken fragments of `raw` from raw offset `from` on. Every item keeps the raw
 * range of the fragment (what the page must show) and of its whole sentence
 * (what gets highlighted while its fragments are spoken).
 */
export function planSpeech(raw,options={},from=0){
 const prepared=rustSpeechPipeline(readerUI(),raw,options,Number(from))
 if(prepared===undefined)throw new TypeError('Unsupported speech text')
 return prepared
}

/** First complete sentence beginning on the visible page, in original offsets.
 * Previous physical-page text distinguishes a continuation from a new sentence. */
export function firstCompleteSentenceOffset(raw, from = 0, previousText = '', options = {}) {
  const prefix = previousText ? String(previousText).trimEnd() + ' ' : '';
  const start = prefix.length + Math.max(0, Number(from) || 0);
  const item = planSpeech(prefix + raw, {footnotes:options.footnotes}, 0)
    .find(item => item.sentence.start >= start);
  return item ? item.sentence.start - prefix.length : String(raw).length;
}
