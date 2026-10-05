// The neural voice engine proper: downloads (install/remove/refresh), and reading aloud (speak/stop) with a look-ahead
// pipeline  text -> worker (phonemise + ONNX) -> chunks -> gapless Web Audio queue -> 'inhouse-tts' events.
// index.js loads this file lazily (dynamic import on first use); the app's start-up never pays for it.
//
// How reading flows: the reader calls speak(fragment k, upcoming = [k+1, k+2...]) when fragment k-1 is 'done'. The engine
// already synthesised (and scheduled, back to back on the audio clock) those upcoming fragments while k-1 played, so that
// speak(k) just ADOPTS the entry it has prepared for k (same text, voice and rate) and the sound never stops. Anything else
// (another voice/rate/text, a jump) is a clean restart. Synthesis runs ahead of playback by up to ~30 s of audio / 6
// fragments (memory-bounded). If the voice cannot keep up it waits (buffering: silence, never garbage); after repeated
// underruns, or a compute speed far below real time, it buffers complete fragments and keeps the selected natural voice.
import { findNeuralVoice, modelsOf, neuralVoices } from './catalog.js'
import { GaplessPlayer, safeToStart } from './player.js'
import { NativePcmPlayer } from './native-player.js'
import { storeError } from './store.js'
import { NeuralPackageStore } from './package-store.js'
import { SynthClient } from './client.js'
import { NativeSynthClient } from './native-client.js'
import { audioContext, nativeAudio, nativePcmBridge, unlockAudio } from './audio.js'

export const LIMITS = {
  idleMs: 90_000,          // without speech for this long the worker (and its ~0.6 GB) is terminated; the next speak rebuilds it
  lookaheadSec: 30,        // synthesise ahead while less than this much audio is waiting to be played
  maxAhead: 6,             // ... and at most this many fragments ahead of the one playing
  maxUpcoming: 6,          // fragments of `upcoming` the engine looks at
  maxHoldMs: 5000,         // never stay silent longer than this just to get a better head start
  underrunLimit: 3,        // underruns within underrunWindowMs that switch to complete-fragment buffering
  underrunWindowMs: 120_000,
  cleanFragments: 8,       // this many fragments in a row without an underrun forgive the earlier ones
  slowRtf: 1.6,            // compute seconds per audio second above which (after minRtfSamples chunks) it cannot keep up at all
  maxRtfSample: 3.2,       // one chunk counts for no more than this: a stall of a few seconds (the worker descheduled, the app in the background) is not a slow device
  minRtfSamples: 3,
  coldStartMs: 5000,       // assumed cost of rebuilding the worker (replaced by what the first build measured); a jump that would wait longer for the running segment rebuilds it instead
  rtfPrior: 0.7,           // assumed compute speed before anything was measured
  lruEntries: 40, lruSamples: 6_000_000   // synthesised fragments kept for replays (~24 MB of Float32 at most)
}

const clampRate = rate => Math.min(3, Math.max(0.5, Number(rate) || 1))
const now = () => globalThis.performance?.now?.() ?? Date.now()

/** Synthesised fragments by voice+rate+text, oldest dropped first, bounded by entries and total samples. */
export class FragmentCache {
  constructor(maxEntries, maxSamples) { Object.assign(this, { maxEntries, maxSamples }); this.map = new Map(); this.samples = 0 }
  get size() { return this.map.size }
  get(key) {
    const hit = this.map.get(key)
    if (!hit) return null
    this.map.delete(key); this.map.set(key, hit) // most recent last
    return hit.chunks
  }
  put(key, chunks) {
    this.delete(key)
    const samples = chunks.reduce((sum, chunk) => sum + chunk.pcm.length, 0)
    if (samples > this.maxSamples) return
    this.map.set(key, { chunks, samples }); this.samples += samples
    while (this.map.size > this.maxEntries || this.samples > this.maxSamples) this.delete(this.map.keys().next().value)
  }
  delete(key) { const hit = this.map.get(key); if (hit) { this.samples -= hit.samples; this.map.delete(key) } }
  clear() { this.map.clear(); this.samples = 0 }
}

function defaultCreateClient(store) {
  const base = new URL(`${import.meta.env?.BASE_URL || '/'}neural-voice/`, globalThis.location?.href || 'http://localhost/').href
  if (globalThis.InhouseInference?.getProtocol?.() === 1) return new NativeSynthClient({store,phonBase:`${base}phon/`})
  return new SynthClient({
    createWorker: () => new Worker(new URL('./worker.js', import.meta.url), { type: 'module' }),
    ortBase: `${base}ort/`,
    phonBase: `${base}phon/`,
    readModel: id => store.readModel(id),
    readConfig: id => store.readConfig(id),
    readPhonemizerModel: id => store.readPhonemizerModel?.(id) || null,
    readRuntimeAssets: id => store.readRuntimeAssets?.(id) || null,
    onStage: typeof nativePcmBridge()?.reportSynthesisStage === 'function' ? (domain, stage, request, part) => {
      const audio = nativeAudio()
      if (audio) audio.bridge.reportSynthesisStage(audio.session, domain, stage, request, part)
    } : null
  })
}

export class NeuralEngine extends EventTarget {
  /**
   * Everything environmental is injectable (tests use fakes for the worker, the audio context, Cache Storage and timers).
   * @param {object} [deps]
   */
  constructor({ voices = neuralVoices, store, createClient, audio, env = globalThis, setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = id => clearTimeout(id), limits = {} } = {}) {
    super()
    this.voices = voices
    this.models = modelsOf(voices)
    this.store = store || new NeuralPackageStore()
    this.createClient = createClient || (() => defaultCreateClient(this.store))
    this.audio = audio || { context: audioContext, unlock: () => unlockAudio(env) }
    this.env = env
    this.setTimer = setTimer; this.clearTimer = clearTimer
    this.limits = { ...LIMITS, ...limits }
    this.cache = new FragmentCache(this.limits.lruEntries, this.limits.lruSamples)
    const playback = { onStart:n => this.#unitStarted(n), onEnd:n => this.#unitEnded(n) }
    this.player = !audio && nativePcmBridge(env)
      ? new NativePcmPlayer({ env, ...playback, onError:reason => {
        const id = this.currentId
        this.#hardStop(); this.#emit('error', id, reason)
      } })
      : new GaplessPlayer({ context:() => this.audio.context(), ...playback, setTimer, clearTimer })
    this._installed = new Set()
    this._downloads = new Map()
    this.installing = new Map() // piperId -> promise
    this.aborts = new Map()     // piperId -> AbortController of the download in progress
    this.client = null
    this.run = null
    this.unitSeq = 0
    this.currentId = null
    this.idleTimer = null
    this._status = 'idle'
    this.underrunTimes = []
    this.cleanStreak = 0
    this.stats = { rtf: 0, underruns: 0, firstAudioMs: 0, cacheHits: 0, prefetchHits:0, tooSlow: 0 }
  }

  // ----------------------------------------------------------------- state exposed to the picker
  static isSupported(env = globalThis) {
    return typeof env.Worker === 'function' && typeof env.WebAssembly === 'object' && !!(env.AudioContext || env.webkitAudioContext || nativePcmBridge(env)) && !!env.caches
  }
  get supported() { return NeuralEngine.isSupported(this.env) }
  get installed() { return this._installed }
  get downloads() { return this._downloads }
  /** 'idle' | 'loading' (starting the worker / the model) | 'buffering' (waiting for audio to be computed) | 'speaking'. */
  get status() { return this._status }
  /** Whitelisted numeric state, sampled without reading book text or calling the native clock. */
  getDiagnosticState() {
    const run = this.run, entries = run?.entries || []
    const count = predicate => entries.filter(predicate).length
    return { loaded:true, moduleLoading:false, queuedRequests:0, status:this._status,
      run:Boolean(run), job:Boolean(run?.job), prepared:run?.prepared === 'pending' ? 'pending' : run?.prepared === 'ready' ? 'ready' : 'none',
      workerAlive:Boolean(this.client?.alive), currentUnit:entries.find(entry => entry.id === this.currentId)?.n ?? null,
      entryCount:entries.length, queued:count(entry => entry.state === 'queued'), synth:count(entry => entry.state === 'synth'),
      done:count(entry => entry.state === 'done'), started:count(entry => entry.started), ended:count(entry => entry.ended), deferred:count(entry => entry.deferred),
      gateOpen:Boolean(run?.gateOpen), buffered:Boolean(run?.buffered),
      scheduledChunks:entries.reduce((sum,entry) => sum + entry.scheduled,0), availableChunks:entries.reduce((sum,entry) => sum + entry.chunks.length,0),
      timers:{ pump:run?.pumpTimer != null, feed:run?.feedTimer != null, hold:run?.holdTimer != null, idle:this.idleTimer != null }
    }
  }
  #setStatus(status) {
    if (status === this._status) return
    this._status = status
    this.dispatchEvent(new Event('status'))
  }
  #changed() { this.dispatchEvent(new Event('change')) }

  async refresh() {
    let next
    try {
      if (this.store.listVoices) next = await this.store.listVoices(this.voices)
      else { const piperIds = await this.store.list(); next = new Set(this.voices.filter(voice => piperIds.has(voice.piperId)).map(voice => voice.id)) }
    } catch { next = new Set() }
    if (next.size === this._installed.size && [...next].every(id => this._installed.has(id))) return
    this._installed = next
    this.#changed()
  }

  // ----------------------------------------------------------------- downloads
  async install(id, { signal } = {}) {
    const voice = findNeuralVoice(id, this.voices)
    if (!voice || !this.supported) throw Object.assign(new Error('unsupported'), { code: 'unsupported' })
    const { piperId } = voice
    const siblings = this.models.get(piperId)
    if (siblings.every(v => this._installed.has(v.id)) && !this._downloads.has(id)) return
    if (this.installing.has(piperId)) return this.installing.get(piperId)
    const publish = (entry) => { for (const v of siblings) this._downloads.set(v.id, entry); this.#changed() }
    publish({ state: 'downloading', fraction: 0, received: 0, total: 0 })
    // The download is shared by the speakers of one model, so cancel(id) of any of them aborts it (not only the caller's signal).
    const abort = new AbortController()
    if (signal?.aborted) abort.abort(); else signal?.addEventListener?.('abort', () => abort.abort(), { once: true })
    this.aborts.set(piperId, abort)
    let lastPublished = 0
    const job = (async () => {
      try {
        await this.store.download(piperId, {
          signal: abort.signal,
          onProgress: ({ received, total, fraction }) => {
            const at = now()
            if (at - lastPublished < 120 && fraction < 1) return // 'change' on every network chunk would flood the picker
            lastPublished = at
            publish({ state: 'downloading', fraction, received, total })
          }
        })
        for (const v of siblings) { this._installed.add(v.id); this._downloads.delete(v.id) }
        this.#changed()
      } catch (error) {
        const aborted = error.code === 'aborted'
        for (const v of siblings) { if (aborted) this._downloads.delete(v.id); else this._downloads.set(v.id, { state: 'error', fraction: 0, received: 0, total: 0, error: error.message, code: error.code }) }
        this.#changed()
        throw error.code ? error : storeError('http', error.message, error)
      } finally { this.installing.delete(piperId); if (this.aborts.get(piperId) === abort) this.aborts.delete(piperId) }
    })()
    this.installing.set(piperId, job)
    return job
  }

  /** Aborts the download of the model this voice belongs to (whichever of its speakers asked for it). */
  cancel(id) {
    const voice = findNeuralVoice(id, this.voices)
    if (voice) this.aborts.get(voice.piperId)?.abort()
  }

  async remove(id) {
    const voice = findNeuralVoice(id, this.voices)
    if (!voice) return
    if (this.run?.voice.piperId === voice.piperId) {
      // A voice being read cannot be answered any more: stop() fires no event, so say it for the current fragment (the reader
      // carries on with another voice) instead of leaving it waiting for a 'done' that never comes.
      const id = this.currentId
      this.stop()
      this.#emit('error', id, 'not-installed')
    }
    if (this.client?.loaded === voice.piperId && !this.run) this.#teardown() // (a run on another voice replaces the session by itself)
    await this.store.remove(voice.piperId)
    for (const v of this.models.get(voice.piperId)) { this._installed.delete(v.id); this._downloads.delete(v.id) }
    for (const key of [...this.cache.map.keys()]) if (key.startsWith(`${voice.piperId}#`)) this.cache.delete(key)
    this.#changed()
  }

  // ----------------------------------------------------------------- reading aloud
  unlock({ playback = true } = {}) { if (playback || !nativePcmBridge(this.env)) this.audio.unlock() }

  /**
   * Starts the worker and loads the voice's model ahead of the first speak() (a cold start is 3-6 s: worker, ONNX
   * Runtime, a 63 MB model). Resolves when ready, never rejects; the idle teardown still applies if nothing is spoken.
   */
  async warmUp(voiceId) {
    const voice = findNeuralVoice(voiceId, this.voices)
    if (!voice || !this._installed.has(voice.id) || !this.supported) return false
    if (this.run) return false // a warm-up must not replace the model a reading is using
    this.#clearIdle()
    this.#refreshStyleSession(voice)
    let client = this.client
    try {
      client ||= this.client = this.createClient()
      await client.prepare(voice.piperId)
      if (this.client !== client) return false
      if (!this.run) this.#armIdle()
      return true
    } catch { if (this.client === client && !this.run) this.#teardown(); return false }
  }

  #emit(type, id, reason) {
    if (id == null) return
    const detail = reason ? { type, id, reason } : { type, id }
    queueMicrotask(() => this.env.dispatchEvent?.(new CustomEvent('inhouse-tts', { detail })))
  }

  speak({ text, voiceId, rate = 1, id, upcoming = [], deferAfter = Infinity }) {
    this.#clearIdle()
    const voice = findNeuralVoice(voiceId, this.voices)
    if (!voice || !this._installed.has(voice.id)) { this.#hardStop(); this.#emit('error', id, 'not-installed'); return }
    if (!this.audio.context() && !this.audio.unlock()) { this.#hardStop(); this.#emit('error', id, 'init-failed'); return }
    this.#watch(this.audio.context())
    rate = clampRate(rate)
    const upcomingTexts = (upcoming || []).slice(0, this.limits.maxUpcoming)
    let run = this.run
    const head = run && run.voice.id === voice.id && run.rate === rate ? run.entries.find(entry => entry.id == null) : null
    if (head && head.text === text) {
      this.#adopt(run, head, id, upcomingTexts, false, deferAfter)
    } else {
      // A page read to its end hands over to a fresh run (the reader asks for the next page's first fragment): the hiccup it
      // may have had (a short heading before a long sentence leaves a hole while the long one is computed) is history, so
      // short pages cannot add up to a 'too-slow' verdict on a device that keeps up. A restart in mid-page keeps its record.
      if (run?.entries.length && run.entries.every(entry => entry.ended)) this.underrunTimes = []
      const rebuild = this.#worthRebuilding(run)
      this.#hardStop({ keepSession:true })
      if (rebuild) this.#teardown() // a running segment cannot be interrupted: when waiting for it costs more than a cold start, start afresh
      run = this.run = { voice, rate, entries: [], gateOpen: false, buffered: false, prepared: null, job: null, heldSince: null, holdTimer: null, pumpTimer: null, feedTimer: null, rtf: 0, rtfN: 0, spi: 0, t0: now(), firstAudio: false }
      this.#adopt(run, this.#entry(run, text), id, upcomingTexts, true, deferAfter)
      this.#setStatus('buffering')
    }
    this.#feed(run)
    this.#pump()
  }

  /** Append a prepared page while this fragment plays, without restarting it.
   * Deferred PCM is computed/cached but cannot reach the audio player until
   * the reader adopts its fragment with an actual speak() call. */
  extendUpcoming({ id, voiceId, rate = 1, upcoming = [], deferAfter = Infinity }) {
    const run = this.run
    if (!run || this.currentId !== id || run.voice.id !== voiceId || run.rate !== clampRate(rate)) return false
    const current = run.entries.find(entry => entry.id === id)
    if (!current || current.ended) return false
    this.#adopt(run, current, id, upcoming.slice(0, this.limits.maxUpcoming), false, deferAfter, false)
    this.#feed(run); this.#pump()
    return true
  }

  stop() {
    this.#hardStop()
    this.#armIdle()
  }

  // Release only on an explicit book close. Ordinary stop/pause retain their cache.
  release() {
    try { this.#hardStop() } finally {
      this.#clearIdle()
      const client = this.client
      this.client = null
      this.cache.clear()
      try { client?.dispose() } catch { /* generation/ownership already invalidated */ }
    }
  }

  pause() {
    this.#hardStop({ pause:true })
    this.#armIdle()
  }
  /** Cancel a changed voice/rate without tearing down the native foreground session. */
  cancelCurrent() { this.#hardStop({ keepSession:true }); this.#armIdle() }

  // The system can take the audio away (a call, Bluetooth switching, the OS suspending the page): that is 'interrupted',
  // which the reader treats as a pause. Not by us: we never suspend or close the context.
  #watch(ctx) {
    if (!ctx || ctx === this.watched) return
    this.watched = ctx
    this.sawRunning = ctx.state === 'running'
    ctx.addEventListener?.('statechange', () => {
      if (ctx !== this.watched) return
      if (ctx.state === 'running') { this.sawRunning = true; return }
      if (!this.run || (ctx.state === 'suspended' && !this.sawRunning)) return
      const id = this.currentId
      this.#hardStop()
      this.#emit('interrupted', id)
    })
  }

  // A run is a continuous stretch of reading with one voice and rate; its entries are the fragments, in reading order.
  #entry(run, text, deferred = false) {
    const profile = run.voice.runtime === 'supertonic3' ? `${run.voice.style}:${run.voice.lang}` : run.voice.speaker
    const entry = { n: ++this.unitSeq, text, key: `${run.voice.piperId}#${profile}|${run.rate}|${text}`, deferred, id: null, state: 'queued', chunks: [], scheduled: 0, total: null, counts: null, started: false, ended: false, error: null }
    const cached = this.cache.get(entry.key)
    if (cached) { entry.chunks = cached.slice(); entry.total = cached.length; entry.state = 'done'; this.stats.cacheHits++ }
    run.entries.push(entry)
    return entry
  }

  #adopt(run, head, id, upcoming, fresh = false, deferAfter = Infinity, announce = true) {
    if (head.deferred) {
      if (head.state === 'done') this.stats.prefetchHits++
      run.gateOpen = false; run.heldSince = null
    }
    head.deferred = false
    head.id = id
    this.currentId = id
    if (!fresh) {
      run.entries = run.entries.filter((entry, i) => !entry.ended || entry === head) // fragments already heard are history
      const at = run.entries.indexOf(head)
      const after = run.entries.slice(at + 1)
      let keep = 0
      while (keep < after.length && keep < upcoming.length && after[keep].text === upcoming[keep]) keep++
      for (let index = 0; index < keep; index++) after[index].deferred = index >= deferAfter
      const dropped = after.slice(keep)
      if (dropped.length) {
        for (const entry of dropped) if (entry.state === 'synth') { run.job?.cancel(); run.job = null }
        run.entries.length = at + 1 + keep
        this.player.truncateAfter(run.entries.at(-1).n)
      }
      for (let index = keep; index < upcoming.length; index++) this.#entry(run, upcoming[index], index >= deferAfter)
    } else {
      for (let index = 0; index < upcoming.length; index++) this.#entry(run, upcoming[index], index >= deferAfter)
    }
    // Whatever already happened to the adopted fragment is reported now, as if it had been live.
    if (head.error) { this.#emit('error', id, head.error); this.#hardStop(); return }
    if (announce && head.started) this.#emit('start', id)
    if (announce && head.ended) this.#emit('done', id)
  }

  #hardStop(playback = {}) {
    const run = this.run
    this.run = null
    this.currentId = null
    if (run) {
      run.job?.cancel()
      for (const key of ['holdTimer','pumpTimer','feedTimer']) { this.clearTimer(run[key]); run[key] = null }
    }
    this.player.stopAll(playback)
    this.#setStatus('idle')
  }

  /** Starts computing the next queued fragment when the look-ahead window allows it. */
  #pump() {
    const run = this.run
    if (!run || run.job) return
    if (run.entries.some(e => e.error)) return // nothing after a failed fragment can be played: do not compute it
    const entry = run.entries.find(e => e.state === 'queued')
    if (!entry) return
    // Later cached sentences cannot play across this missing sentence. Only
    // the prefix before it can justify delaying its synthesis; counting the
    // whole cache here can leave an empty player waiting on a background timer.
    const prefix = run.entries.slice(0, run.entries.indexOf(entry))
    const ahead = prefix.filter(e => !e.started && e.state !== 'queued').length
    const waiting = this.#heldSeconds({entries:prefix}) + this.player.buffered()
    if (ahead && waiting >= this.limits.lookaheadSec) {
      // enough audio is queued: look again when playback has eaten into it (nothing else would wake us before the next fragment starts)
      this.clearTimer(run.pumpTimer)
      const timer = this.setTimer(() => { if (run.pumpTimer === timer) run.pumpTimer = null; this.#pump() }, (waiting - this.limits.lookaheadSec + 0.25) * 1000)
      run.pumpTimer = timer
      return
    }
    if (ahead >= this.limits.maxAhead) return
    if (!run.prepared) { this.#prepare(run); return }
    if (run.prepared === 'pending') return
    entry.state = 'synth'
    run.segStart = now()
    const rate = run.rate, speaker = run.voice.speaker
    run.job = this.client.synth({ text: entry.text, rate, speaker, ...(run.voice.runtime === 'supertonic3' ? { lang:run.voice.lang, style:run.voice.style } : {}) }, {
      onPlan: counts => { entry.counts = counts; entry.total = counts.length },
      onChunk: chunk => this.#chunk(run, entry, chunk),
      onEnd: () => { run.job = null; this.#finish(run, entry); this.#pump() },
      onError: error => { run.job = null; this.#failEntry(run, entry, error.code === 'init-failed' ? 'init-failed' : 'synth-failed') }
    })
  }

  async #prepare(run) {
    run.prepared = 'pending'
    this.#setStatus('loading')
    const t = now()
    try {
      this.#refreshStyleSession(run.voice)
      const cold = !this.client?.alive
      this.client ||= this.createClient()
      await this.client.prepare(run.voice.piperId)
      if (cold) this.coldMs = Math.max(1500, now() - t)
    } catch (error) {
      if (this.run !== run) return
      const id = this.currentId
      this.#hardStop(); this.#teardown()
      this.#emit('error', id, 'init-failed')
      return
    }
    if (this.run !== run) return
    run.prepared = 'ready'
    this.#setStatus('buffering')
    this.#pump()
  }

  #refreshStyleSession(voice) {
    // Expanding an installed pack does not interrupt its current audiobook.
    // Selecting a newly downloaded profile replaces a legacy three-style
    // worker before synthesis; all profiles then reuse that single session.
    if (voice.runtime === 'supertonic3' && this.client?.loaded === voice.piperId &&
        this.client.config?.runtime === 'supertonic3' && !this.client.config.styles?.[voice.style]) this.#teardown()
  }

  /**
   * A jump (another text, speed or voice) cannot cancel the segment the worker is computing: its answer is waited for. That
   * wait is predicted from the plan (ids of the segment x seconds per id x compute speed) and compared with what rebuilding
   * the worker costs (a cold start, measured the first time). Only when the wait would be longer is the worker dropped.
   */
  #worthRebuilding(run) {
    if (!run?.job || !this.client?.alive) return false
    const entry = run.entries.find(e => e.state === 'synth')
    const ids = entry?.counts?.[entry.chunks.length]
    if (!ids) return false // not phonemised yet: nothing is being computed
    const rtf = run.rtfN ? run.rtf : this.limits.rtfPrior, spi = run.spi || 0.03 / run.rate
    const remaining = ids * spi * rtf * 1000 - (now() - run.segStart)
    return remaining > (this.coldMs || this.limits.coldStartMs)
  }

  #chunk(run, entry, { index, last, pcm, sampleRate, ms }) {
    if (this.run !== run) return
    run.segStart = now()
    const dur = pcm.length / sampleRate
    const ids = entry.counts?.[index] || 0
    if (ids && dur > 0.2) run.spi = run.spi ? run.spi * 0.5 + (dur / ids) * 0.5 : dur / ids
    if (ms > 0 && dur > 0.2) {
      const rtf = Math.min(ms / 1000 / dur, this.limits.maxRtfSample)
      run.rtf = run.rtfN ? run.rtf * 0.6 + rtf * 0.4 : rtf
      run.rtfN++
      this.stats.rtf = run.rtf
    }
    entry.chunks.push({ pcm, sampleRate, dur, last })
    if (last) this.#finish(run, entry)
    if (run.rtfN >= this.limits.minRtfSamples && run.rtf > this.limits.slowRtf) this.#bufferSlow()
    this.#feed(run)
    this.#pump()
  }

  #finish(run, entry) {
    if (entry.state === 'done') return
    entry.state = 'done'
    entry.total = entry.chunks.length
    if (entry.chunks.length && entry.chunks.at(-1).last) this.cache.put(entry.key, entry.chunks)
  }

  #failEntry(run, entry, code) {
    if (this.run !== run) return
    entry.error = code; entry.state = 'done'
    if (code === 'synth-failed') this.#teardown() // a worker that failed is not asked again (a dead one crashes the page): the next fragment gets a fresh one
    if (entry.id != null) { const id = entry.id; this.#hardStop(); this.#emit('error', id, code); return }
    this.#feed(run) // earlier fragments keep playing; the error is reported when the reader asks for this one
  }

  #heldSeconds(run) {
    let seconds = 0
    for (const entry of run.entries) for (let i = entry.scheduled; i < entry.chunks.length; i++) seconds += entry.chunks[i].dur
    return seconds
  }

  /** May we start (or restart after a stall) playing what is in hand? See safeToStart(). */
  #gateOpens(run) {
    const ready = [], pending = []
    let incomplete = null
    for (const entry of run.entries) {
      if (entry.ended) continue
      if (entry.deferred) break
      if (entry.error) break
      for (let i = entry.scheduled; i < entry.chunks.length; i++) ready.push(entry.chunks[i].dur)
      if (entry.total == null || entry.chunks.length < entry.total) { incomplete = entry; break }
    }
    if (!ready.length) return false
    if (run.buffered) return true // #feed admits only complete fragments in this mode
    if (incomplete?.counts) {
      const spi = run.spi || 0.03 / run.rate
      for (let i = incomplete.chunks.length; i < incomplete.counts.length; i++) pending.push(incomplete.counts[i] * spi)
    }
    if (run.heldSince != null && now() - run.heldSince >= this.limits.maxHoldMs) return true
    return safeToStart({ ready, pending, rtf: run.rtfN ? run.rtf : this.limits.rtfPrior })
  }

  /** Hands every chunk in hand to the player, in reading order; holds back while the gate says the voice would stall. */
  #feed(run) {
    if (this.run !== run) return
    for (const entry of run.entries) {
      if (entry.error) return
      if (entry.deferred) return
      if (run.buffered && entry.state !== 'done') { this.#setStatus('buffering'); return }
      while (entry.scheduled < entry.chunks.length) {
        // Cached replays already contain every ahead fragment. Bound delivery
        // to AudioTrack as well as synthesis: its native queue is finite.
        // Keep the exact PCM in the cache until the rendered clock frees room.
        const waiting = this.player instanceof NativePcmPlayer ? this.player.buffered() : 0
        if (waiting > 0 && waiting + entry.chunks[entry.scheduled].dur > this.limits.lookaheadSec) {
          this.clearTimer(run.feedTimer)
          const timer = this.setTimer(() => { if (run.feedTimer === timer) run.feedTimer = null; this.#feed(run) }, 1000)
          run.feedTimer = timer
          return
        }
        if (run.gateOpen && this.player.drained()) { run.gateOpen = false; this.#underrun(); if (this.run !== run) return }
        if (!run.gateOpen) {
          if (run.heldSince == null) run.heldSince = now()
          if (!this.#gateOpens(run)) { this.#armHold(run); return }
          run.gateOpen = true; run.heldSince = null
          this.clearTimer(run.holdTimer); run.holdTimer = null
        }
        const chunk = entry.chunks[entry.scheduled++]
        try { this.player.schedule(entry.n, chunk.pcm, chunk.sampleRate, { last: !!chunk.last }) }
        catch { this.#failEntry(run, entry, 'native-playback-failed'); return }
        if (this.run !== run) return
      }
      if (entry.total == null || entry.scheduled < entry.total) return // the next fragment waits for this one's remaining chunks
    }
  }

  #armHold(run) {
    this.#setStatus('buffering')
    this.clearTimer(run.holdTimer)
    const timer = this.setTimer(() => { if (run.holdTimer === timer) run.holdTimer = null; this.#feed(run) }, Math.max(50, this.limits.maxHoldMs - (now() - run.heldSince)))
    run.holdTimer = timer
  }

  #underrun() {
    const at = now()
    this.stats.underruns++
    this.underrunTimes = this.underrunTimes.filter(t => at - t < this.limits.underrunWindowMs)
    this.underrunTimes.push(at)
    this.cleanStreak = 0
    this.#setStatus('buffering')
    if (this.underrunTimes.length >= this.limits.underrunLimit) this.#bufferSlow()
  }

  #bufferSlow() {
    const run = this.run
    if (!run || run.buffered) return
    run.buffered = true
    this.stats.tooSlow++
    this.underrunTimes = []
    this.#setStatus('buffering')
  }

  #entryOf(n) { return this.run?.entries.find(entry => entry.n === n) }
  #unitStarted(n) {
    const run = this.run, entry = this.#entryOf(n)
    if (!entry) return
    entry.started = true
    if (!run.firstAudio) { run.firstAudio = true; this.stats.firstAudioMs = now() - run.t0 }
    this.#setStatus('speaking')
    if (entry.id != null) this.#emit('start', entry.id)
    this.#feed(run)
    this.#pump()
  }
  #unitEnded(n) {
    const run = this.run, entry = this.#entryOf(n)
    if (!entry) return
    entry.ended = true
    if (++this.cleanStreak >= this.limits.cleanFragments) this.underrunTimes = []
    if (entry.id != null) this.#emit('done', entry.id)
    entry.chunks = [] // the cache keeps its own reference for replays
    // AudioTrack receipts carry the real rendered clock. Release queued PCM
    // here too, so an outstanding throttled delivery timer is not required.
    this.#feed(run)
    this.#pump()
    if (run.entries.every(e => e.ended) && !run.job) { this.#setStatus('idle'); this.#armIdle() }
  }

  // ----------------------------------------------------------------- idle teardown
  #clearIdle() { this.clearTimer(this.idleTimer); this.idleTimer = null }
  #armIdle() {
    this.#clearIdle()
    this.idleTimer = this.setTimer(() => {
      this.idleTimer = null
      if (this.run && !this.run.entries.every(e => e.ended)) return this.#armIdle()
      this.#teardown()
    }, this.limits.idleMs)
  }
  #teardown() {
    this.#clearIdle()
    this.client?.dispose()
    this.client = null
    if (this.run) this.run.prepared = null // the next fragment to synthesise rebuilds the worker
  }
}

export { storeError }
