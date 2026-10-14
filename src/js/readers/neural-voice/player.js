// Web Audio playback of synthesised chunks: a gapless queue (every chunk is scheduled to start exactly when the previous one
// ends, on the audio clock, not on a JS timer) plus exact 'start'/'done' notifications per unit (a unit is one spoken
// fragment made of one or more chunks). The 'start' of a unit fires when its first sample is AUDIBLE: the audio clock time
// plus the output latency of the device. All time comes from context.currentTime, so the class is testable with a fake context.
// The scheduling is rust-ui (neural_player.rs); this class keeps the injected context and timers and the closures the
// browser calls back.
import { readerUI as ui } from '../rust-ui-required.js'

export class GaplessPlayer {
  /**
   * @param {{context:()=>BaseAudioContext|null, onStart?:(unit:number)=>void, onEnd?:(unit:number)=>void,
   *          setTimer?:typeof setTimeout, clearTimer?:typeof clearTimeout}} options
   */
  constructor({ context, onStart = () => {}, onEnd = () => {}, onMark = () => {}, setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = id => clearTimeout(id) }) {
    Object.assign(this, { getContext: context, onStart, onEnd, onMark, setTimer, clearTimer })
    this.units = new Map()   // unit -> { sources:[{source,start,end}], start, end, complete, started, ended, timers:Set }
    this.nextTime = 0        // audio-clock end of everything scheduled
    this.scheduled = false   // something was scheduled since the last stopAll()
  }

  get now() { return ui().gapless_now(this) }
  /** Time between a sample being rendered and being heard (speaker/Bluetooth pipeline). */
  get latency() { return ui().gapless_latency(this) }
  /** Seconds of audio scheduled but not yet played. */
  buffered() { return ui().gapless_buffered(this) }
  /** Everything scheduled has been rendered (the queue ran dry): whatever arrives next starts a new silence-broken stretch. */
  drained() { return ui().gapless_drained(this) }
  /** The unit being heard now, or null. */
  playing() { return ui().player_playing(this) }
  /**
   * Queues a chunk of unit `unit` right after what is already scheduled. `last` marks the unit's final chunk (its
   * 'done' is armed then). Returns the audio-clock time the chunk starts at.
   */
  schedule(unit, pcm, sampleRate, options) { return ui().gapless_schedule(this, unit, pcm, sampleRate, options) }
  /** Silences everything at once and forgets it: no 'start'/'done' will fire for what was queued. */
  stopAll() { ui().gapless_stop_all(this) }
  /** Drops the units after `unit` (the reader changed what comes next) and makes the queue end where `unit` ends. */
  truncateAfter(unit) { ui().player_truncate_after(this, unit) }
  _wake(u, time, task, slot, ms) { return slot.handle = this.setTimer(() => ui().gapless_arm(this, u, time, task, slot), ms) }
  _released(source) { return () => { try { source.disconnect() } catch { /* already */ } } }
}

/**
 * Is it safe to start talking now? `ready` are the durations (s) of the chunks in hand, `pending` the predicted durations of
 * the chunks still being computed, `rtf` the compute seconds per audio second. We may start once every pending chunk
 * will be finished (within `slack`) before the audio in front of it runs out; otherwise the voice would stop mid-sentence.
 */
export const safeToStart = ({ ready = [], pending = [], rtf = 0.7, slack = 0.3 }) => ui().player_safe_to_start(ready, pending, rtf, slack)
