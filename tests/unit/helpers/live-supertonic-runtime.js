// Test harness: the production module src/js/readers/neural-voice/supertonic-runtime.js and the doorways to the Rust kernels that only the
// tests and the frozen references use (no production module imports them, so they left src).
export * from '../../../src/js/readers/neural-voice/supertonic-runtime.js'
import { loadedRustVoiceUI as voice } from '../../../src/js/rust-voice-ui.js'
/**
 * Never squeeze the model's latent below its normal predicted duration.
 * Faster playback is applied to complete speech, with pitch-preserving tempo
 * processing, after inference. A percentage margin still lost words at 2x.
 */
export const supertonicSeconds=(predicted,rate)=>voice().voice_host_supertonic_seconds(+predicted,rate);
/** Small chunks bound latent/audio memory. Upstream recommends <=300 chars
 * (120 for Korean/Japanese); the reader usually already supplies one sentence. */
export const supertonicTextChunks=(text,lang)=>voice().voice_host_supertonic_chunks(String(text||''),['ko','ja'].includes(lang)?120:300);
