// Test harness: the production module src/js/readers/neural-voice/hebrew.js and the doorways to the Rust kernels that only the
// tests and the frozen references use (no production module imports them, so they left src).
export * from '../../../src/js/readers/neural-voice/hebrew.js'
import { loadedRustVoiceUI as voice } from '../../../src/js/rust-voice-ui.js'
/** The IPA of a Hebrew text with niqqud: words joined by a space, as upstream does. */
export const hebrewToIpa = text => voice().voice_host_hebrew_ipa(text)
/** The ids of the characters of the official Nakdimon alphabet (any niqqud already in the text is ignored). */
export const nakdimonInputIds = text => voice().voice_host_nakdimon_ids(text)
/** Merge model predictions onto the ORIGINAL characters, in Nakdimon's dagesh/dot/vowel order. */
export const mergeNiqqud = (letters, outputs) => voice().voice_host_merge_niqqud(letters, outputs)
/** IPA code points use the voice's table, not the fixed table in the espeak WASM program. */
export const phonemeIdsFromIpa = (ipa, idMap) => voice().voice_host_ipa_ids(ipa, idMap)
