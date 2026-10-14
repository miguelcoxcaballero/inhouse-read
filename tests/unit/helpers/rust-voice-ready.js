import { readFileSync } from 'node:fs'
import { loadRustVoiceCore } from '../../../src/js/rust-voice-core.js'

// The synthesis worker and the Android client await the voice core before they synthesise (their init does), and the
// rules of the voice have no JavaScript twin: suites that call them directly start from the same state, the real module
// loaded through the app's own loader. A suite that resets modules and imports them again awaits its own copy.
export const rustVoiceCore = await loadRustVoiceCore({ bytes: readFileSync('src/wasm/inhouse_read_voice.wasm') })
if (!rustVoiceCore) throw new Error('Rust voice core did not load in the test environment')
