// Test harness: the production module src/js/readers/neural-voice/synth-flow.js and the doorways to the Rust kernels that only the
// tests and the frozen references use (no production module imports them, so they left src).
export * from '../../../src/js/readers/neural-voice/synth-flow.js'
import { loadedRustVoiceUI as voice } from '../../../src/js/rust-voice-ui.js'
/** length_scale for a speaking rate: Piper stretches time, so a faster voice is a smaller scale. */
export const lengthScaleFor = (base, rate) => voice().voice_host_length_scale(base, rate)
/** The speed the model itself is asked for: never faster than its natural pace. */
export const synthesisRate = rate => voice().voice_host_synthesis_rate(rate)
