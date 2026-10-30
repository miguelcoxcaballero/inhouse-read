// Dictionaries from the same piper-tts-web 1.1.2/espeak-ng build as the shipped phonemizer, kept verified in Cache Storage,
// which survives a cold worker and offline reading. The descriptors (exact lengths and SHA-256), the aliases and the cached,
// verified download are the voice module (rust-ui/src/voice_dictionary.rs, also built into the UI module for the voice
// download); this file is the synthesis worker's doorway to them.
import { loadedRustVoiceUI } from '../../rust-voice-ui.js'

export const DICTIONARY_CACHE_NAME = 'inhouse-neural-dictionaries-v1'
export const PACKAGED_DICTIONARIES = Object.freeze(['ca', 'cs', 'da', 'de', 'en', 'es', 'fi', 'fr', 'hu', 'it', 'nl', 'pl', 'pt', 'ro', 'sv', 'tr'])

/** null for an embedded/unknown language; the config's actual espeak voice determines its dictionary. */
export const dictionaryNeeded = espeakVoice => loadedRustVoiceUI().voice_dictionary_needed(espeakVoice)

export const dictionaryUrl = (base, name) => `${base}dict/${name}_dict`

/**
 * Returns a fresh verified Response. Install and playback use this SAME URL/cache, so a downloaded voice's first
 * sentence can be spoken offline even when its language has never been loaded into an Emscripten filesystem.
 */
export async function fetchDictionary(url, options) { return loadedRustVoiceUI().voice_dictionary_fetch(url, options) }
