// The Android sink receives the same mono Float32 PCM produced by Piper or
// Supertonic. Playback events come from AudioTrack, never a JavaScript timer.
import { nativeAudio, pauseNativeAudio, stopNativeAudio } from './audio.js'
let epochSequence = 0

export function encodePcm(pcm, encode = globalThis.btoa) {
  const bytes = new Uint8Array(pcm.length * 4)
  const view = new DataView(bytes.buffer)
  for (let i = 0; i < pcm.length; i++) {
    if (!Number.isFinite(pcm[i])) throw new Error('invalid PCM')
    view.setFloat32(i * 4, pcm[i], true)
  }
  const parts = []
  for (let i = 0; i < bytes.length; i += 4096) parts.push(String.fromCharCode(...bytes.subarray(i, i + 4096)))
  return encode(parts.join(''))
}

export class NativePcmPlayer {
  constructor({ env = globalThis, onStart = () => {}, onEnd = () => {}, onError = () => {} } = {}) {
    Object.assign(this, { env, onStart, onEnd, onError })
    this.units = new Map()
    this.nextTime = 0
    this.scheduled = false
    this.session = null
    this.epoch = ++epochSequence
    this.listener = event => {
      const detail = event.detail
      if (!detail || detail.session !== (this.session || nativeAudio()?.session)) return
      if (detail.epoch != null && detail.epoch !== this.epoch) return
      const unit = this.units.get(detail.unit)
      if (detail.type === 'error') { if (detail.unit >= 0 && !unit) return; this.onError(detail.reason || 'native-playback'); return }
      if (!unit) return
      if (detail.type === 'start' && !unit.started) { unit.started = true; this.onStart(detail.unit) }
      if (detail.type === 'done' && unit.started && !unit.ended) {
        unit.ended = true; this.units.delete(detail.unit); this.onEnd(detail.unit)
      }
    }
    env.addEventListener?.('inhouse-pcm', this.listener)
  }
  get now() {
    const state = nativeAudio()
    if (!state || state.session !== this.session) return 0
    try {
      const clock = JSON.parse(state.bridge.getState())
      return clock.session === this.session && clock.epoch === this.epoch && Number.isFinite(clock.playedSeconds) ? Math.max(0, clock.playedSeconds) : 0
    } catch { return 0 }
  }
  get latency() { return 0 } // AudioTrack reports rendered frames itself.
  buffered() { return this.scheduled ? Math.max(0, this.nextTime - this.now) : 0 }
  drained() { return this.scheduled && this.nextTime <= this.now + .004 }
  playing() { for (const [id, unit] of this.units) if (unit.started && !unit.ended) return id; return null }
  schedule(id, pcm, sampleRate, { last = false } = {}) {
    const state = nativeAudio()
    if (!state || !(pcm instanceof Float32Array) || !pcm.length || !Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 96000) throw new Error('invalid native audio')
    const encoded = encodePcm(pcm, this.env.btoa?.bind(this.env) || globalThis.btoa)
    if (this.session !== state.session) {
      this.units.clear(); this.nextTime = 0; this.scheduled = false; this.session = state.session
      this.epoch = ++epochSequence; state.bridge.reset(state.session, this.epoch)
    }
    const start = Math.max(this.nextTime, this.now), end = start + pcm.length / sampleRate
    let unit = this.units.get(id)
    if (!unit) { unit = { start, end, started: false, ended: false }; this.units.set(id, unit) }
    unit.end = end; unit.complete = last
    this.nextTime = end; this.scheduled = true
    // Register before crossing the bridge: a sink may synchronously report a
    // start/error. Cancellation must never lose that first authentic event.
    state.bridge.enqueue(state.session, this.epoch, id, encoded, sampleRate, last)
    return start
  }
  stopAll({ keepSession = false, pause = false } = {}) {
    this.units.clear(); this.nextTime = 0; this.scheduled = false
    this.epoch = ++epochSequence
    const state = nativeAudio()
    if (keepSession && state) state.bridge.reset(state.session, this.epoch)
    else if (pause) pauseNativeAudio()
    else stopNativeAudio()
    if (!keepSession) this.session = null
  }
  truncateAfter(id) {
    for (const [n] of this.units) if (n > id) this.units.delete(n)
    this.nextTime = this.units.size ? Math.max(...[...this.units.values()].map(u => u.end)) : this.nextTime
    const state = nativeAudio()
    if (state && state.session === this.session) state.bridge.truncateAfter(state.session, this.epoch, id)
  }
  dispose() { this.stopAll(); this.env.removeEventListener?.('inhouse-pcm', this.listener) }
}
