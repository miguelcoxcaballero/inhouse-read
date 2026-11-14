// FROZEN copy of src/js/readers/neural-voice/engine.js as it was before its constructor, its limits and the closures it
// hands to the browser moved to rust-ui (neural_engine_shell.rs). Only the import paths changed. Do not edit: the
// differential test neural-engine-shell-wasm.test.js compares the Rust shell with it.
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
import { modelsOf, neuralVoices } from '../../../src/js/readers/neural-voice/catalog.js'
import { GaplessPlayer } from '../../../src/js/readers/neural-voice/player.js'
import { NativePcmPlayer } from '../../../src/js/readers/neural-voice/native-player.js'
import { storeError } from '../../../src/js/readers/neural-voice/store.js'
import { NeuralPackageStore } from '../../../src/js/readers/neural-voice/package-store.js'
import { SynthClient } from '../../../src/js/readers/neural-voice/client.js'
import { NativeSynthClient } from '../../../src/js/readers/neural-voice/native-client.js'
import { audioContext, nativeAudio, nativePcmBridge, unlockAudio } from '../../../src/js/readers/neural-voice/audio.js'
import { readerUI as ui } from '../../../src/js/readers/rust-ui-required.js'

// What was an `async` method: the promise of the Rust flow itself (neural_engine_flows.rs), a rejected one when the module is missing.
const waiting = flow => { try { return flow(ui()) } catch (error) { return Promise.reject(error) } }

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
    createWorker: () => new Worker(new URL('../../../src/js/readers/neural-voice/worker.js', import.meta.url), { type: 'module' }),
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

  refresh() { return waiting(ui => ui.neural_refresh(this)) }

  // ----------------------------------------------------------------- downloads
  install(id, options = undefined) { return waiting(ui => ui.neural_install(this, id, options, ui, storeError)) }
  /** Aborts the download of the model this voice belongs to (whichever of its speakers asked for it). */
  cancel(id) { ui().neural_cancel(this, id) }
  remove(id) { return waiting(ui => ui.neural_remove(this, id)) }

  // ----------------------------------------------------------------- reading aloud
  unlock(options) { ui().neural_unlock(this, options, nativePcmBridge) }
  /** Starts the worker and loads the voice's model ahead of the first speak(). Resolves when ready, never rejects. */
  warmUp(voiceId) { return waiting(ui => ui.neural_warm_up(this, voiceId)) }
  /** Prepare up to six opening fragments silently; Play adopts even in-flight synthesis. */
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
  _prepare(run) { ui().neural_prepare(this, run) }
}

export { storeError }
