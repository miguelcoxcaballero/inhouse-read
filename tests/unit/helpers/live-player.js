// Test harness: the production module src/js/readers/neural-voice/player.js and the doorways to the Rust kernels that only the
// tests and the frozen references use (no production module imports them, so they left src).
export * from '../../../src/js/readers/neural-voice/player.js'
import { readerUI as ui } from '../../../src/js/readers/rust-ui-required.js'
/**
 * Is it safe to start talking now? `ready` are the durations (s) of the chunks in hand, `pending` the predicted durations of
 * the chunks still being computed, `rtf` the compute seconds per audio second. We may start once every pending chunk
 * will be finished (within `slack`) before the audio in front of it runs out; otherwise the voice would stop mid-sentence.
 */
export const safeToStart = ({ ready = [], pending = [], rtf = 0.7, slack = 0.3 }) => ui().player_safe_to_start(ready, pending, rtf, slack)
