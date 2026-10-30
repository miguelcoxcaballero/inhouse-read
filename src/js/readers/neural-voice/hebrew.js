// Hebrew Piper phonemization: Nakdimon restores niqqud, then the official Hebrew rules produce IPA.
// Ported from OHF-Voice/piper1-gpl at efffbfb226bfb511ebbcf55d0cecd8b35a89743d:
// src/piper/hebrew/{__init__,hebrew_ipa}.py and src/piper/phonemize_hebrew.py.
// The Nakdimon tables/merge are MIT, Copyright 2022 Elazar Gershuni; see public/neural-voice/hebrew-NOTICE.txt.
// The Piper IPA converter is distributed under Piper's GPL-3.0 licence (public/neural-voice/phon/COPYING).
//
// The rules (syllables, consonants, vowels, sheva, stress), the Nakdimon alphabet, the merge of the model's predictions and
// the packing of the text (with the browser's Unicode normalisation and classes) are Rust (rust-ui/src/voice_kernels.rs over
// rust-core/src/hebrew.rs). What stays here is the module's wiring. tests/unit/helpers/reference-hebrew.js
// is the frozen JavaScript implementation the Rust one is compared with.
import { loadedRustVoiceUI as voice } from '../../rust-voice-ui.js'

/** The IPA of a Hebrew text with niqqud: words joined by a space, as upstream does. */
export const hebrewToIpa = text => voice().voice_host_hebrew_ipa(text)
/** The ids of the characters of the official Nakdimon alphabet (any niqqud already in the text is ignored). */
export const nakdimonInputIds = text => voice().voice_host_nakdimon_ids(text)
/** Merge model predictions onto the ORIGINAL characters, in Nakdimon's dagesh/dot/vowel order. */
export const mergeNiqqud = (letters, outputs) => voice().voice_host_merge_niqqud(letters, outputs)
/** IPA code points use the voice's table, not the fixed table in the espeak WASM program. */
export const phonemeIdsFromIpa = (ipa, idMap) => voice().voice_host_ipa_ids(ipa, idMap)

const KIT = { noop: () => {} }
/** Cached Nakdimon bytes are passed from the page; this module never downloads during reading. The session checks, the
 * queue, the inference and its release are the voice module (rust-ui/src/voice_hebrew.rs). */
const create = ({ ort, model, config }) => voice().voice_hebrew_create({ ort, model, config }, KIT)
export function createHebrewPhonemizer(options) {
  try { return create(options) } catch (error) { return Promise.reject(error) }
}
