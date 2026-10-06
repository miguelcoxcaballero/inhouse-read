// Web Audio playback of synthesised chunks: a gapless queue (every chunk is scheduled to start exactly when the previous one
// ends, on the audio clock, not on a JS timer) plus exact 'start'/'done' notifications per unit (a unit is one spoken
// fragment made of one or more chunks). The 'start' of a unit fires when its first sample is AUDIBLE: the audio clock time
// plus the output latency of the device. All time comes from context.currentTime, so the class is testable with a fake context.

const LEAD = 0.03          // seconds between "now" and the first sample of an idle queue (room to schedule it)
const EPSILON = 0.004      // tolerance when comparing audio-clock times
const MIN_POLL = 0.025

export class GaplessPlayer {
  /**
   * @param {{context:()=>BaseAudioContext|null, onStart?:(unit:number)=>void, onEnd?:(unit:number)=>void,
   *          setTimer?:typeof setTimeout, clearTimer?:typeof clearTimeout}} options
   */
  constructor({ context, onStart = () => {}, onEnd = () => {}, setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = id => clearTimeout(id) }) {
    Object.assign(this, { getContext: context, onStart, onEnd, setTimer, clearTimer })
    this.units = new Map()   // unit -> { sources:[{source,start,end}], start, end, complete, started, ended, timers:Set }
    this.nextTime = 0        // audio-clock end of everything scheduled
    this.scheduled = false   // something was scheduled since the last stopAll()
  }

  get now() { return this.getContext()?.currentTime ?? 0 }
  /** Time between a sample being rendered and being heard (speaker/Bluetooth pipeline). */
  get latency() {
    const ctx = this.getContext()
    const value = Number(ctx?.outputLatency) || Number(ctx?.baseLatency) || 0
    // Bluetooth output can lag by more than half a second: compensate all of it.
    return Math.min(0.8, Math.max(0, value))
  }
  /** Seconds of audio scheduled but not yet played. */
  buffered() { return this.scheduled ? Math.max(0, this.nextTime - this.now) : 0 }
  /** Everything scheduled has been rendered (the queue ran dry): whatever arrives next starts a new silence-broken stretch. */
  drained() { return this.scheduled && this.nextTime <= this.now + EPSILON }
  /** The unit being heard now, or null. */
  playing() {
    for (const [unit, u] of this.units) if (u.started && !u.ended) return unit
    return null
  }

  /**
   * Queues a chunk of unit `unit` right after what is already scheduled. `last` marks the unit's final chunk (its
   * 'done' is armed then). Returns the audio-clock time the chunk starts at.
   */
  schedule(unit, pcm, sampleRate, { last = false } = {}) {
    const ctx = this.getContext()
    if (!ctx) throw new Error('no AudioContext')
    const buffer = ctx.createBuffer(1, Math.max(1, pcm.length), sampleRate)
    buffer.copyToChannel(pcm.length ? pcm : new Float32Array(1), 0)
    const source = ctx.createBufferSource()
    source.buffer = buffer
    source.connect(ctx.destination)
    const start = Math.max(this.nextTime, ctx.currentTime + LEAD)
    const end = start + buffer.duration
    source.onended = () => { try { source.disconnect() } catch { /* already */ } }
    source.start(start)
    this.nextTime = end
    this.scheduled = true
    let u = this.units.get(unit)
    if (!u) { u = { sources: [], start, end, complete: false, started: false, ended: false, timers: new Set() }; this.units.set(unit, u); this.#when(u, start, () => { u.started = true; this.onStart(unit) }) }
    u.sources.push({ source, start, end })
    u.end = end
    if (last) { u.complete = true; this.#when(u, end, () => { u.ended = true; this.units.delete(unit); this.onEnd(unit) }) }
    return start
  }

  // Runs `fn` when the audio clock (plus the output latency) reaches `time`; a timer only wakes us up, the clock decides.
  #when(u, time, fn) {
    const arm = () => {
      const remaining = time + this.latency - this.now
      if (remaining <= EPSILON) { u.timers.delete(handle); fn(); return }
      u.timers.delete(handle)
      handle = this.setTimer(arm, Math.max(MIN_POLL, remaining) * 1000)
      u.timers.add(handle)
    }
    let handle = this.setTimer(arm, Math.max(0, time + this.latency - this.now) * 1000)
    u.timers.add(handle)
  }

  #drop(u) {
    for (const timer of u.timers) this.clearTimer(timer)
    u.timers.clear()
    for (const { source } of u.sources) {
      try { source.onended = null; source.stop() } catch { /* never started or already ended */ }
      try { source.disconnect() } catch { /* already */ }
    }
  }

  /** Silences everything at once and forgets it: no 'start'/'done' will fire for what was queued. */
  stopAll() {
    for (const u of this.units.values()) this.#drop(u)
    this.units.clear()
    this.nextTime = 0
    this.scheduled = false
  }

  /** Drops the units after `unit` (the reader changed what comes next) and makes the queue end where `unit` ends. */
  truncateAfter(unit) {
    for (const [n, u] of [...this.units]) if (n > unit) { this.#drop(u); this.units.delete(n) }
    const ends = [...this.units.values()].map(u => u.end)
    this.nextTime = ends.length ? Math.max(...ends) : this.nextTime
  }
}

/**
 * Is it safe to start talking now? `ready` are the durations (s) of the chunks in hand, `pending` the predicted durations of
 * the chunks still being computed, `rtf` the compute seconds per audio second. We may start once every pending chunk
 * will be finished (within `slack`) before the audio in front of it runs out; otherwise the voice would stop mid-sentence.
 */
export function safeToStart({ ready = [], pending = [], rtf = 0.7, slack = 0.3 }) {
  let have = ready.reduce((sum, d) => sum + d, 0)
  let spent = 0
  for (const duration of pending) {
    spent += rtf * duration
    if (spent > have + slack) return false
    have += duration
  }
  return true
}
