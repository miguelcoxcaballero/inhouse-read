// Test harness: the production module src/js/readers/neural-voice/dictionary-cache.js and the doorways to the Rust kernels that only the
// tests and the frozen references use (no production module imports them, so they left src).
export * from '../../../src/js/readers/neural-voice/dictionary-cache.js'
import { loadedRustVoiceUI } from '../../../src/js/rust-voice-ui.js'
export const DICTIONARY_CACHE_NAME = 'inhouse-neural-dictionaries-v1'
export const PACKAGED_DICTIONARIES = Object.freeze(['ca', 'cs', 'da', 'de', 'en', 'es', 'fi', 'fr', 'hu', 'it', 'nl', 'pl', 'pt', 'ro', 'sv', 'tr'])
/** null for an embedded/unknown language; the config's actual espeak voice determines its dictionary. */
export const dictionaryNeeded = espeakVoice => loadedRustVoiceUI().voice_dictionary_needed(espeakVoice)
