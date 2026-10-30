import { readFileSync } from 'node:fs'
import { loadRustVoiceUI } from '../../../src/js/rust-voice-ui.js'

// The synthesis worker and the Android client await the voice module (VoiceClientPlan.ready) before they synthesise, and
// its kernels have no JavaScript twin: suites start from the same state, the real module loaded through the app's own
// loader. It lives on the realm, so a suite that resets modules keeps using this instance. Compiled once per process.
const module = (process.__inhouseVoiceUIModule ??= new WebAssembly.Module(readFileSync('src/wasm/voice/inhouse_read_voice_ui_bg.wasm')))
export const rustVoiceUI = await loadRustVoiceUI({ module })
if (!rustVoiceUI) throw new Error('Rust voice module did not load in the test environment')
