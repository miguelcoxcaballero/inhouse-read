// Test harness: what src/js/readers/voice-catalog.js and voice-order.js exported, word for word, over the kernels of
// rust-ui with the page's own callbacks (normalizeLang, localeCompare, Intl.DisplayNames). The reader no longer calls
// these: it asks rust-ui for a whole list in one visit (neuralVoiceList in neural-runtime.js, catalog_neural_voices) and
// for the rest through catalog_doors.rs, whose doors tests/unit/catalog-doors-wasm.test.js compares with the frozen
// original. The tests that pin each kernel against tests/unit/helpers/reference-voice-catalog.js, or build their
// voices with it, still import them from here.
import {readerUI} from '../../../src/js/readers/rust-ui-required.js'
import {normalizeLang,langBase} from '../../../src/js/readers/voice-catalog.js'
export * from '../../../src/js/readers/voice-catalog.js'

/**
 * A catalogue entry of neural-voice/index.js ({id,lang,name,quality:'medium'|'high',sizeMB,speaker,recommended}) as a voice.
 * `installed` is a Set (or array) of the ids downloaded so far. Null for anything that is not one of ours.
 */
export const normalizeNeuralVoice = (entry, installed = []) => readerUI().catalog_neural_voice(entry, installed, normalizeLang)

export const detectLanguage=(text,fallback='en-US')=>readerUI().detect_voice_language(text,fallback,normalizeLang)

/** Same value as NEURAL_PREFIX in neural-voice/index.js (a test keeps them equal); repeated here so this file stays pure and the engine stays lazily loaded. */
export const NEURAL_ID_PREFIX = 'piper:'
export const isNeuralId = id => typeof id === 'string' && (id.startsWith(NEURAL_ID_PREFIX) || /^supertonic3:([FM][1-5]):[a-z]{2}$/.test(id))

/**
 * The language a book itself declares (its metadata), or ''. reader.language falls back to the device's language, which says
 * nothing about the book: a PDF has no language and is often read with a device in another one.
 */
export function declaredLanguage(reader) {
  try { const language = reader?.metadata?.language; return String((Array.isArray(language) ? language[0] : language) || '') } catch { return '' }
}

const langRegion = tag => normalizeLang(tag).split('-')[1] || ''

/**
 * The voice and language for one utterance. An explicit choice always wins, except with 'Voz multilingüe' on and a
 * chunk in another language: then that language gets ITS best voice. Without an explicit choice the best natural
 * voice for the language is used. `voiceId` is '' when the system default should decide (no matching voice).
 * The catalogue only holds records made by rust-ui (catalog_neural_voices): Rust leaves anything else unanswered.
 */
export function resolveVoice(voices, options) {
  const answer = readerUI().catalog_resolve_voice(voices, options, normalizeLang, (a, b) => a.localeCompare(b))
  if (answer === undefined) throw new TypeError('Unsupported neural voice record')
  return answer
}

// Names are in Spanish because the UI is; Intl.DisplayNames covers the long tail (the table is in Rust).
const hostName = (code, type) => {
  let name = ''
  try { const value = new Intl.DisplayNames(['es'], { type }).of(code); name = value && value !== code ? value : '' } catch { name = '' }
  name ||= code
  return type === 'language' ? name.charAt(0).toLocaleUpperCase('es') + name.slice(1) : name
}
/** 'Español' for 'es-MX' (the language alone, without the region). */
export const baseLanguageName = tag => readerUI().catalog_base_language_name(langBase(tag), hostName)
/** 'México' for 'es-MX'; '' when the tag has no region. */
export const regionName = tag => readerUI().catalog_region_name(langRegion(tag), hostName)
export const languageName = tag => readerUI().catalog_language_name(langBase(tag), langRegion(tag), hostName)

// --- voice-order.js ---
const collator=(a,b,spanish)=>spanish?a.localeCompare(b,'es'):a.localeCompare(b)
const list=voices=>Array.isArray(voices)?voices:[...(voices||[])]
// The catalogue only holds records produced by normalizeNeuralVoice. Rust leaves
// anything else unanswered (undefined) instead of coercing it.
const answer=result=>{if(result===undefined)throw new TypeError('Unsupported neural voice record');return result}
export function orderNeuralVoices(voices,{bookLang='',deviceLang=''}={}){
 return answer(readerUI().voice_order(list(voices),bookLang,deviceLang,normalizeLang,languageName,collator))
}
export function recommendedNeuralFor(voices,lang,deviceLang=''){
 return answer(readerUI().voice_recommended(list(voices),lang,deviceLang,normalizeLang,languageName,collator))
}
