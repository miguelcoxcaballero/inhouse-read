// Test harness: the record of one neural voice as src/js/readers/voice-catalog.js exported it. The reader asks rust-ui
// for a whole list in one visit (neuralVoiceList in neural-runtime.js, catalog_neural_voices); this calls the kernel of a
// single record, for the tests that pin it against tests/unit/helpers/reference-voice-catalog.js or build their voices with it.
import {readerUI} from '../../../src/js/readers/rust-ui-required.js'
import {normalizeLang} from '../../../src/js/readers/voice-catalog.js'
export * from '../../../src/js/readers/voice-catalog.js'

/**
 * A catalogue entry of neural-voice/index.js ({id,lang,name,quality:'medium'|'high',sizeMB,speaker,recommended}) as a voice.
 * `installed` is a Set (or array) of the ids downloaded so far. Null for anything that is not one of ours.
 */
export const normalizeNeuralVoice = (entry, installed = []) => readerUI().catalog_neural_voice(entry, installed, normalizeLang)
