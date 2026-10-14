// The Android sink receives the same mono Float32 PCM produced by Piper or
// Supertonic. Playback events come from AudioTrack, never a JavaScript timer.
// The queue, the slicing at page marks and the receipts are rust-ui (neural_player.rs).
import { nativeAudio, pauseNativeAudio, stopNativeAudio } from './audio.js'
import { readerUI as ui } from '../rust-ui-required.js'
let epochSequence = 0
const audio = { nativeAudio, pauseNativeAudio, stopNativeAudio }

export const encodePcm = (pcm, encode = globalThis.btoa) => ui().native_encode_pcm(pcm, encode)

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
    this.listener = event => ui().native_event(this, event, audio)
    env.addEventListener?.('inhouse-pcm', this.listener)
  }
  get now() { return ui().native_clock(this, audio) }
  get latency() { return 0 } // AudioTrack reports rendered frames itself.
  buffered() { return ui().native_buffered(this, audio) }
  drained() { return ui().native_drained(this, audio) }
  playing() { return ui().player_playing(this) }
  schedule(id, pcm, sampleRate, options) { return ui().native_schedule(this, id, pcm, sampleRate, options, audio) }
  stopAll(options) { ui().native_stop_all(this, options, audio) }
  truncateAfter(id) { ui().native_truncate_after(this, id, audio) }
  dispose() { this.stopAll(); this.env.removeEventListener?.('inhouse-pcm', this.listener) }
  _nextEpoch() { return ++epochSequence }
  _encoder() { return this.env.btoa?.bind(this.env) || globalThis.btoa }
}
