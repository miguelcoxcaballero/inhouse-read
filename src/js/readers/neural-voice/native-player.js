// The Android sink receives the same mono Float32 PCM produced by Piper or
// Supertonic. Playback events come from AudioTrack, never a JavaScript timer.
// The queue, the slicing at page marks and the receipts are rust-ui (neural_player.rs).
import { readerUI as ui } from '../rust-ui-required.js'
let epochSequence = 0

export class NativePcmPlayer {
  constructor({ env = globalThis, onStart = () => {}, onEnd = () => {}, onMark = () => {}, onError = () => {} } = {}) {
    Object.assign(this, { env, onStart, onEnd, onMark, onError })
    this.units = new Map()
    this.wires = new Map(); this.wireSequence = 0
    this.wireEnds = new Map()
    this.nextTime = 0
    this.scheduled = false
    this.session = null
    this.epoch = ++epochSequence
    this.listener = event => ui().native_event(this, event)
    env.addEventListener?.('inhouse-pcm', this.listener)
  }
  get now() { return ui().native_clock(this) }
  get latency() { return 0 } // AudioTrack reports rendered frames itself.
  buffered() { return ui().native_buffered(this) }
  drained() { return ui().native_drained(this) }
  playing() { return ui().player_playing(this) }
  schedule(id, pcm, sampleRate, options) { return ui().native_schedule(this, id, pcm, sampleRate, options) }
  stopAll(options) { ui().native_stop_all(this, options) }
  truncateAfter(id) { ui().native_truncate_after(this, id) }
  dispose() { this.stopAll(); this.env.removeEventListener?.('inhouse-pcm', this.listener) }
  _nextEpoch() { return ++epochSequence }
  _encoder() { return this.env.btoa?.bind(this.env) || globalThis.btoa }
}
