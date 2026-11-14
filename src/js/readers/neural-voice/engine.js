// The neural voice engine proper: downloads (install/remove/refresh), and reading aloud (speak/stop) with a look-ahead
// pipeline  text -> worker (phonemise + ONNX) -> chunks -> gapless Web Audio queue -> 'inhouse-tts' events.
// index.js loads this file lazily (dynamic import on first use); the app's start-up never pays for it.
// Every decision, the constructor and the functions the browser calls back are rust-ui (neural_engine.rs,
// neural_engine_flows.rs, neural_engine_shell.rs). This class is the EventTarget whose plain fields the reader, the
// diagnostics and the tests look at; the module keeps the imports and the Worker URL, which the bundler must see.
import { modelsOf, neuralVoices } from './catalog.js'
import { GaplessPlayer } from './player.js'
import { NativePcmPlayer } from './native-player.js'
import { storeError } from './store.js'
import { NeuralPackageStore } from './package-store.js'
import { SynthClient } from './client.js'
import { NativeSynthClient } from './native-client.js'
import { audioContext, nativeAudio, nativePcmBridge, unlockAudio } from './audio.js'
import { readerUI as ui } from '../rust-ui-required.js'

// What was an `async` method: the promise of the Rust flow itself (neural_engine_flows.rs), a rejected one when the module is missing.
const waiting = flow => { try { return flow(ui()) } catch (error) { return Promise.reject(error) } }

// The engine's limits (each one is explained in neural_engine_shell.rs). A literal: this module is evaluated without the Rust UI.
export const LIMITS = { idleMs: 90_000, lookaheadSec: 30, maxAhead: 6, maxUpcoming: 6, maxHoldMs: 5000, underrunLimit: 3, underrunWindowMs: 120_000, cleanFragments: 8,
  slowRtf: 1.6, maxRtfSample: 3.2, minRtfSamples: 3, coldStartMs: 5000, rtfPrior: 0.7, lruEntries: 40, lruSamples: 6_000_000 }

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
const kit = { neuralVoices, modelsOf, NeuralPackageStore, defaultCreateClient, audioContext, unlockAudio, nativePcmBridge, NativePcmPlayer, GaplessPlayer, FragmentCache, LIMITS }

export class NeuralEngine extends EventTarget {
  /** @param {object} [deps] voices, store, createClient, audio, env, setTimer, clearTimer, limits (tests inject fakes) */
  constructor(deps) { super(); ui().neural_construct(this, deps, kit) }

  static isSupported(env = globalThis) { return ui().neural_supported(env, nativePcmBridge) }
  get supported() { return NeuralEngine.isSupported(this.env) }
  get installed() { return this._installed }
  get downloads() { return this._downloads }
  get nativePlayer() { return this.player instanceof NativePcmPlayer }
  get status() { return this._status }
  getDiagnosticState() { return ui().neural_diagnostic_state(this) }
  refresh() { return waiting(ui => ui.neural_refresh(this)) }
  install(id, options = undefined) { return waiting(ui => ui.neural_install(this, id, options, ui, storeError)) }
  cancel(id) { ui().neural_cancel(this, id) }
  remove(id) { return waiting(ui => ui.neural_remove(this, id)) }
  unlock(options) { ui().neural_unlock(this, options, nativePcmBridge) }
  warmUp(voiceId) { return waiting(ui => ui.neural_warm_up(this, voiceId)) }
  prime(request) { return ui().neural_prime(this, request) }
  speak(request) { ui().neural_speak(this, request) }
  extendUpcoming(request) { return ui().neural_extend_upcoming(this, request) }
  stop() { ui().neural_stop(this) }
  release() { ui().neural_release(this) }
  pause() { ui().neural_pause(this) }
  cancelCurrent() { ui().neural_cancel_current(this) }
  _prepare(run) { ui().neural_prepare(this, run) }
}

export { storeError }
