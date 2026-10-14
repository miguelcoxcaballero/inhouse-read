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
//
// Every decision lives in rust-ui (neural_engine.rs). This class owns what has to stay JavaScript: the EventTarget, the
// injected dependencies (worker client, player, store, timers) and the closures the browser calls back, which keep their
// lifetime with the garbage collector. The run, its entries, the statistics and the cache are plain objects the engine's
// readers (the reader, the diagnostics, the tests) look at.
import { modelsOf, neuralVoices } from './catalog.js'
import { GaplessPlayer } from './player.js'
import { NativePcmPlayer } from './native-player.js'
import { storeError } from './store.js'
import { NeuralPackageStore } from './package-store.js'
import { SynthClient } from './client.js'
import { NativeSynthClient } from './native-client.js'
import { audioContext, nativeAudio, nativePcmBridge, unlockAudio } from './audio.js'
import { readerUI as ui } from '../rust-ui-required.js'

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

/** Synthesised fragments by voice+rate+text, oldest dropped first, bounded by entries and total samples. */
export class FragmentCache {
  constructor(maxEntries, maxSamples) { Object.assign(this, { maxEntries, maxSamples }); this.map = new Map(); this.samples = 0 }
  get size() { return this.map.size }
  get(key) { return ui().neural_cache_get(this, key) }
  put(key, chunks) { ui().neural_cache_put(this, key, chunks) }
  delete(key) { ui().neural_cache_delete(this, key) }
  clear() { ui().neural_cache_clear(this) }
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
    const playback = { onStart:n => ui().neural_unit_started(this, n), onEnd:n => ui().neural_unit_ended(this, n), onMark:(n,offset) => ui().neural_unit_mark(this, n, offset) }
    this.player = !audio && nativePcmBridge(env)
      ? new NativePcmPlayer({ env, ...playback, onError:reason => ui().neural_player_error(this, reason) })
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
  static isSupported(env = globalThis) { return ui().neural_supported(env, nativePcmBridge) }
  get supported() { return NeuralEngine.isSupported(this.env) }
  get installed() { return this._installed }
  get downloads() { return this._downloads }
  get nativePlayer() { return this.player instanceof NativePcmPlayer }
  /** 'idle' | 'loading' (starting the worker / the model) | 'buffering' (waiting for audio to be computed) | 'speaking'. */
  get status() { return this._status }
  /** Whitelisted numeric state, sampled without reading book text or calling the native clock. */
  getDiagnosticState() { return ui().neural_diagnostic_state(this) }

  async refresh() {
    let next
    try { const [listing, legacy] = ui().neural_list(this); next = ui().neural_listed(this, await listing, legacy) } catch { next = new Set() }
    ui().neural_installed_changed(this, next)
  }

  // ----------------------------------------------------------------- downloads
  async install(id, { signal } = {}) {
    const begun = ui().neural_install_begin(this, id, signal)
    if (!Array.isArray(begun)) return begun // nothing to do, or the download of this model that is already running
    const [voice, siblings, abort] = begun
    let last = 0
    const job = (async () => {
      try {
        await this.store.download(voice.piperId, { signal: abort.signal, onProgress: progress => { last = ui().neural_install_progress(this, siblings, last, progress) } })
        ui().neural_install_done(this, siblings)
      } catch (error) { throw ui().neural_install_failed(this, siblings, error, storeError) }
      finally { ui().neural_install_finally(this, voice.piperId, abort) }
    })()
    this.installing.set(voice.piperId, job)
    return job
  }
  /** Aborts the download of the model this voice belongs to (whichever of its speakers asked for it). */
  cancel(id) { ui().neural_cancel(this, id) }
  async remove(id) {
    const voice = ui().neural_remove_begin(this, id)
    if (!voice) return
    await this.store.remove(voice.piperId)
    ui().neural_remove_end(this, voice)
  }

  // ----------------------------------------------------------------- reading aloud
  unlock(options) { ui().neural_unlock(this, options, nativePcmBridge) }
  /**
   * Starts the worker and loads the voice's model ahead of the first speak() (a cold start is 3-6 s: worker, ONNX
   * Runtime, a 63 MB model). Resolves when ready, never rejects; the idle teardown still applies if nothing is spoken.
   */
  async warmUp(voiceId) {
    const voice = ui().neural_warm_begin(this, voiceId)
    if (!voice) return false
    let client = this.client
    try { client = ui().neural_client(this); await client.prepare(voice.piperId); return ui().neural_warm_done(this, client) }
    catch { return ui().neural_warm_failed(this, client) }
  }
  /** Prepare two opening fragments silently; Play adopts even in-flight synthesis. */
  prime(request) { return ui().neural_prime(this, request) }
  speak(request) { ui().neural_speak(this, request) }
  /** Append a prepared page while this fragment plays, without restarting it.
   * Deferred PCM is computed/cached but cannot reach the audio player until
   * the reader adopts its fragment with an actual speak() call. */
  extendUpcoming(request) { return ui().neural_extend_upcoming(this, request) }
  stop() { ui().neural_stop(this) }
  // Release only on an explicit book close. Ordinary stop/pause retain their cache.
  release() { ui().neural_release(this) }
  pause() { ui().neural_pause(this) }
  /** Cancel a changed voice/rate without tearing down the native foreground session. */
  cancelCurrent() { ui().neural_cancel_current(this) }

  // ----------------------------------------------------------------- closures the engine hands to the browser
  _arm(run, kind, ms) { let timer; return timer = this.setTimer(() => ui().neural_fire(this, run, kind, timer), ms) }
  _handlers(run, entry) {
    return { onPlan: counts => ui().neural_job_plan(entry, counts), onChunk: chunk => ui().neural_job_chunk(this, run, entry, chunk),
      onEnd: () => ui().neural_job_end(this, run, entry), onError: error => ui().neural_job_error(this, run, entry, error) }
  }
  _emit(detail) { queueMicrotask(() => this.env.dispatchEvent?.(new CustomEvent('inhouse-tts', { detail }))) }
  _listen(ctx) { ctx.addEventListener?.('statechange', () => ui().neural_state_change(this, ctx)) }
  _aborter(abort) { return () => abort.abort() }
  _prepare(run) {
    let begun
    try { begun = ui().neural_prepare_begin(this, run) } catch { ui().neural_prepare_failed(this, run); return }
    const [promise, started, cold] = begun
    Promise.resolve(promise).then(() => ui().neural_prepare_ready(this, run, started, cold), () => ui().neural_prepare_failed(this, run))
  }
}

export { storeError }
