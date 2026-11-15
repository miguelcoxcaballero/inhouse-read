import {rustSpeechPipeline,letters,decodeUnits} from './speech-pipeline.js'
import {readerUI} from './rust-ui-required.js'
import {units,properties} from './speech-plan.js'

// Pure text side of the audiobook: turn the raw text a reader exposes into
// sentences and spoken fragments WITHOUT losing where each one came from. The
// reading highlight needs "sentence 7 is raw[1203, 1290)", so every cleanup
// (footnote markers, collapsed whitespace, soft hyphens, repeated headers)
// keeps an index map from the cleaned text back to the raw text.
// All of it is rust-ui (speech_mask.rs, speech_normalize, sentence_ends.rs, speech_fragments, speech_plan.rs); the frozen
// JavaScript original is tests/unit/helpers/reference-speech-text.js. Locale-dependent case folding and Unicode properties
// are the browser's and come in as callbacks. The audiobook asks for a plan and for the first sentence of a page; the
// separate steps (normalizeSpeech, speechSentences, speechChunks), which only tests call, are tests/unit/helpers/live-speech-text.js.

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
  const offset = Number(from), source = prefix + raw;
  const {footnotes = true} = options;
  let text;
  const result = readerUI().speech_first_complete(units(source), prefix.length, offset, Boolean(footnotes),
    (a,b) => units(source.slice(a,b).toLocaleLowerCase()), letters,
    chars => { text = decodeUnits(chars); }, properties, (a,b) => text.slice(a,b).toLocaleLowerCase());
  if (result === null) throw new TypeError('Unsupported speech text');
  return result === undefined ? String(raw).length : result;
}
