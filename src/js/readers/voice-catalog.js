import {readerUI} from './rust-ui-required.js'
export {orderNeuralVoices,recommendedNeuralFor} from './voice-order.js'
export {detectLanguage} from './language-detect.js'
// What the reader knows about the on-device neural voices (Piper and Supertonic, see neural-voice/): language tags, the record of
// a voice of the picker, which voice speaks a text, and the Spanish names of languages. The record, the choice of voice and the
// names are Rust (rust-ui voice_catalog.rs); the tags stay here because they are read before the reader (and rust-ui) loads, when the
// saved preferences are normalised. Nothing calls a cloud TTS: "free and unlimited" means we only choose among on-device voices.
// The frozen JavaScript original, with the ranking of the device's own voices that the reader stopped using, is
// tests/unit/helpers/reference-voice-catalog.js.

const ISO3 = { spa:'es', eng:'en', fra:'fr', fre:'fr', deu:'de', ger:'de', ita:'it', por:'pt', cat:'ca', glg:'gl', nld:'nl', dut:'nl', rus:'ru', jpn:'ja', zho:'zh', chi:'zh', kor:'ko', pol:'pl', ukr:'uk', tur:'tr', swe:'sv', dan:'da', nob:'nb', nor:'nb', no:'nb', fin:'fi', ces:'cs', cze:'cs', ell:'el', gre:'el', hun:'hu', ron:'ro', rum:'ro', ara:'ar', vie:'vi', hin:'hi', heb:'he', tha:'th', iw:'he', bul:'bg', srp:'sr' }

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

/** 'es_ES', 'spa-ESP', 'ES-es' -> 'es-ES' (language lower-case, region upper-case). */
export function normalizeLang(tag) {
  const parts = String(tag || '').trim().replace(/_/g, '-').split('-').filter(Boolean)
  if (!parts.length) return ''
  let language = parts[0].toLowerCase()
  language = ISO3[language] || language
  const region = parts.slice(1).find(part => /^[a-z]{2}$/i.test(part) || /^\d{3}$/.test(part))
  return region ? `${language}-${region.toUpperCase()}` : language
}
export const langBase = tag => normalizeLang(tag).split('-')[0]
const langRegion = tag => normalizeLang(tag).split('-')[1] || ''

/**
 * A catalogue entry of neural-voice/index.js ({id,lang,name,quality:'medium'|'high',sizeMB,speaker,recommended}) as a voice.
 * `installed` is a Set (or array) of the ids downloaded so far. Null for anything that is not one of ours.
 */
export const normalizeNeuralVoice = (entry, installed = []) => readerUI().catalog_neural_voice(entry, installed, normalizeLang)

/**
 * The voice and language for one utterance. An explicit choice always wins, except with 'Voz multilingüe' on and a
 * chunk in another language: then that language gets ITS best voice. Without an explicit choice the best natural
 * voice for the language is used. `voiceId` is '' when the system default should decide (no matching voice).
 * The catalogue only holds records produced by normalizeNeuralVoice: Rust leaves anything else unanswered.
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
