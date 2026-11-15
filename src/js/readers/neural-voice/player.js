// Web Audio playback of synthesised chunks, a gapless queue on the audio clock: the scheduling, what the constructor
// builds and what each member answers are rust-ui (neural_player.rs, which documents them); this class keeps the
// closures the browser calls back.
import { readerUI as ui } from '../rust-ui-required.js'

// What a player is given when its maker gives none: the notifications and the timers.
const defaults = { noop() {}, setTimer: (fn, ms) => setTimeout(fn, ms), clearTimer: id => clearTimeout(id) }

export class GaplessPlayer {
  /**
   * @param {{context:()=>BaseAudioContext|null, onStart?:(unit:number)=>void, onEnd?:(unit:number)=>void,
   *          setTimer?:typeof setTimeout, clearTimer?:typeof clearTimeout}} options
   */
  constructor(options) { ui().gapless_construct(this, options, defaults) }

  get now() { return ui().gapless_now(this) }
  get latency() { return ui().gapless_latency(this) }
  buffered() { return ui().gapless_buffered(this) }
  drained() { return ui().gapless_drained(this) }
  playing() { return ui().player_playing(this) }
  schedule(unit, pcm, sampleRate, options) { return ui().gapless_schedule(this, unit, pcm, sampleRate, options) }
  stopAll() { ui().gapless_stop_all(this) }
  truncateAfter(unit) { ui().player_truncate_after(this, unit) }
  _wake(u, time, task, slot, ms) { return slot.handle = this.setTimer(() => ui().gapless_arm(this, u, time, task, slot), ms) }
  _released(source) { return () => { try { source.disconnect() } catch { /* already */ } } }
}

