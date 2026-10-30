// Expose VITS' existing phoneme durations as a second ONNX output. Weights,
// operators and the audio output are untouched. Unknown graphs stay untouched.
// The protobuf walk and the rewrite are the voice module (rust-ui/src/voice_kernels.rs over rust-core/src/onnx_durations.rs). The ~63 MB model stays in
// this buffer: the core asks for windows of it and skips the weights by their length, because copying the model into
// its memory would keep a second copy resident for nothing. Where the boundaries fall in the audio is synth-flow.js
// (Rust). The frozen JavaScript original is tests/unit/helpers/reference-piper-alignment.js.
import { loadedRustVoiceUI as voice } from '../../rust-voice-ui.js'

/** `{bytes, name}`: the model with the durations output (`name`), or the very same bytes and null for an unknown graph. */
export const exposePiperDurations = input => voice().voice_host_expose_durations(input)

// At most the page boundaries of this utterance are phonemized; acoustic
// inference still runs ONCE for the whole sentence, with its natural prosody.
export function phonemeMarks(text, marks, ids, phonemize) {
  try { return voice().voice_host_phoneme_marks(text, marks, ids, phonemize) } catch (error) { return Promise.reject(error) }
}
