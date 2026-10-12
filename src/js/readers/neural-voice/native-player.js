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
  constructor({ env = globalThis, onStart = () => {}, onEnd = () => {}, onMark = () => {}, onError = () => {} } = {}) {
    Object.assign(this, { env, onStart, onEnd, onMark, onError })
    this.units = new Map()
    this.wires = new Map(); this.wireSequence = 0
    this.wireEnds = new Map()
    this.nextTime = 0
    this.scheduled = false
    this.session = null
    this.epoch = ++epochSequence
    this.listener = event => {
      const detail = event.detail
      if (!detail || detail.session !== (this.session || nativeAudio()?.session)) return
      if (detail.epoch != null && detail.epoch !== this.epoch) return
      const wire = this.wires.get(detail.unit)
      const unit = this.units.get(wire?.id)
      if (detail.type === 'error') { if (detail.unit >= 0 && !unit) return; this.onError(detail.reason || 'native-playback'); return }
      if (!unit) return
      if (detail.type === 'start' && !wire.started) {
        wire.started = true
        if (!unit.started) { unit.started = true; this.onStart(wire.id) }
        if (Number.isInteger(wire.mark)) this.onMark(wire.id,wire.mark)
      }
      if (detail.type === 'done' && unit.started && !unit.ended) {
        this.wires.delete(detail.unit)
        if (wire.final) { unit.ended = true; this.units.delete(wire.id); this.onEnd(wire.id) }
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
  schedule(id, pcm, sampleRate, { last = false, marks = [] } = {}) {
    const state = nativeAudio()
    if (!state || !(pcm instanceof Float32Array) || !pcm.length || !Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 96000) throw new Error('invalid native audio')
    // Reject the complete buffer before enqueueing any slice or changing the
    // playback clock; a corrupt later slice must not leave a partial utterance.
    for (const sample of pcm) if (!Number.isFinite(sample)) throw new Error('invalid PCM')
    if (this.session !== state.session) {
      this.units.clear(); this.wires.clear(); this.wireEnds.clear(); this.nextTime = 0; this.scheduled = false; this.session = state.session
      this.epoch = ++epochSequence; state.bridge.reset(state.session, this.epoch)
    }
    const start = Math.max(this.nextTime, this.now), end = start + pcm.length / sampleRate
    let unit = this.units.get(id)
    if (!unit) { unit = { start, end, started: false, ended: false }; this.units.set(id, unit) }
    unit.end = end; unit.complete = last
    this.nextTime = end; this.scheduled = true
    // Register before crossing the bridge: a sink may synchronously report a
    // start/error. Cancellation must never lose that first authentic event.
    const validMarks = marks.filter(m => Number.isInteger(m.sample) && m.sample >= 0 && m.sample < pcm.length).sort((a,b)=>a.sample-b.sample)
    const cuts = [...new Set([0,...validMarks.map(m=>m.sample),pcm.length])]
    for (let part = 1; part < cuts.length; part++) {
      if (!this.units.has(id) || this.session !== state.session) break
      const wire = this.wireSequence = Math.max(this.wireSequence + 1,id)
      const marker = validMarks.find(m=>m.sample === cuts[part-1])
      this.wires.set(wire,{id,mark:marker?.offset,final:last && part === cuts.length-1})
      unit.lastWire = wire
      this.wireEnds.set(id,wire)
      while (this.wireEnds.size > 64) this.wireEnds.delete(this.wireEnds.keys().next().value)
      const encoded = encodePcm(pcm.subarray(cuts[part-1],cuts[part]),this.env.btoa?.bind(this.env) || globalThis.btoa)
      // Contiguous slices of ONE waveform. No new synthesis, padding or fade:
      // AudioTrack's rendered start receipt is the boundary, also screen-off.
      state.bridge.enqueue(state.session,this.epoch,wire,encoded,sampleRate,true)
    }
    return start
  }
  stopAll({ keepSession = false, pause = false } = {}) {
    this.units.clear(); this.wires.clear(); this.wireEnds.clear(); this.nextTime = 0; this.scheduled = false
    this.epoch = ++epochSequence
    const state = nativeAudio()
    if (keepSession && state) state.bridge.reset(state.session, this.epoch)
    else if (pause) pauseNativeAudio()
    else stopNativeAudio()
    if (!keepSession) this.session = null
  }
  truncateAfter(id) {
    const lastWire = this.units.get(id)?.lastWire ?? this.wireEnds.get(id)
    for (const [n] of this.units) if (n > id) this.units.delete(n)
    for (const [n,wire] of this.wires) if (wire.id > id) this.wires.delete(n)
    this.nextTime = this.units.size ? Math.max(...[...this.units.values()].map(u => u.end)) : this.nextTime
    const state = nativeAudio()
    if (state && state.session === this.session && lastWire != null) state.bridge.truncateAfter(state.session, this.epoch, lastWire)
  }
  dispose() { this.stopAll(); this.env.removeEventListener?.('inhouse-pcm', this.listener) }
}
