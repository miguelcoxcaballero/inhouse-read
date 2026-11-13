// Test harness: the production module src/js/readers/neural-voice/native-player.js and the doorways to the Rust kernels that only the
// tests and the frozen references use (no production module imports them, so they left src).
export * from '../../../src/js/readers/neural-voice/native-player.js'
import { readerUI as ui } from '../../../src/js/readers/rust-ui-required.js'
export const encodePcm = (pcm, encode = globalThis.btoa) => ui().native_encode_pcm(pcm, encode)
