// Test harness: the doorways to the audio of rust-ui (neural_audio.rs) as src/js/readers/neural-voice/audio.js
// exported them, word for word. The engine, the facade, the native player and the reading voice ask rust-ui itself
// now, so no production module imports them; the tests and the frozen references still do.
// The one audio output of the neural voices: the shared AudioContext or, in the Android app, the native PCM session.
// The state and every decision are rust-ui (neural_audio.rs); these are the names the voice modules import.
import { readerUI as ui } from '../../../src/js/readers/rust-ui-required.js'

export const nativePcmBridge = env => ui().audio_bridge(env)
export const nativeAudio = () => ui().audio_native()
export const stopNativeAudio = () => ui().audio_stop_native()
export const pauseNativeAudio = () => ui().audio_pause_native()
/** Creates/resumes the shared AudioContext. Call it synchronously from a click/tap handler. Returns it (or null without Web Audio). */
export const unlockAudio = env => ui().audio_unlock(env)
/** The shared context, if unlock() has created one. */
export const audioContext = () => ui().audio_context()
/** Forget the context (tests). */
export const resetAudio = () => ui().audio_reset()
