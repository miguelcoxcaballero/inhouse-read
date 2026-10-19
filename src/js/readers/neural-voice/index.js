// On-device natural voices (Piper and Supertonic models run by onnxruntime-web in a Worker, played with Web Audio).
// Free, unlimited and offline once a voice is downloaded; nothing is sent anywhere. This file is the CONTRACT between
// the engine and the reading integration (reading-voice.js, voice-catalog.js, the voice picker): the integration only
// imports from here.
//
// The app imports this file at start-up (the picker needs the catalogue), so everything here is tiny: the catalogue, the
// AudioContext unlock, and a facade that loads the real engine (engine.js, with the downloader, the player and the worker
// client) with a dynamic import the first time it is needed. The worker, onnxruntime-web and the phonemizer are loaded
// even later, on the first speak(), inside the worker. Nothing of this reaches the cold start of the 3D shelf.
import { NEURAL_PREFIX, isNeuralVoiceId, neuralVoices } from './catalog.js'
import { nativePcmBridge, pauseNativeAudio, stopNativeAudio, unlockAudio } from './audio.js'

export { NEURAL_PREFIX, isNeuralVoiceId, neuralVoices }
export { piperVoices, supertonicVoices } from './catalog.js'

/**
 * Curated catalogue (see catalog.js), best default of each language first.
 * @typedef {object} NeuralVoice
 * @property {string} id         'piper:es_MX-claude-high' ('piper:<piperId>#<speaker>' for the 2nd+ speaker of a model)
 * @property {string} piperId    shared installation key: a Piper file stem or 'supertonic3'
 * @property {string} lang       BCP-47 tag, 'es-MX'
 * @property {string} name       person/brand name shown in the picker, 'Claude'
 * @property {'low'|'medium'|'high'|'natural'} quality
 * @property {number} sizeMB     download size, ~63
 * @property {number} speaker    speaker id inside the model (0 for single-speaker models)
 * @property {boolean} [recommended]  the one to offer first for its language
 * @property {'supertonic3'} [runtime]  absent for Piper
 * @property {string} [style]  genuine Supertonic speaker profile, independent of language
 * @property {boolean} [sharedPack]  one install/removal affects every profile in the pack
 * @property {string} [licenseUrl]
 */

/**
 * Download state published for the picker while a voice is being fetched. Voices that share one model (the speakers of
 * a multi-speaker model) share its entry. After a failure the entry stays with state 'error' (and `code`) until the next install().
 * @typedef {{state:'downloading'|'error', fraction:number, received:number, total:number, error?:string, code?:string}} NeuralDownload
 */

const NONE = new Set(), NO_DOWNLOADS = new Map()

export class NeuralVoiceEngine extends EventTarget {
  /** Worker + WebAssembly + AudioContext + Cache Storage are all available. */
  static isSupported(env = globalThis) {
    return typeof env.Worker === 'function' && typeof env.WebAssembly === 'object' && !!(env.AudioContext || env.webkitAudioContext || nativePcmBridge(env)) && !!env.caches
  }

  /** @param {object} [options] dependencies handed to the real engine (tests inject fakes; see engine.js) */
  constructor(options = {}) {
    super()
    this.options = options
    this.core = null
    this.loading = null
    this.queue = []
    this.resourceToken = {}
    this.plan = null
  }

  get supported() { return NeuralVoiceEngine.isSupported(this.options.env || globalThis) }
  /** Ids of the voices fully downloaded (kept fresh; see refresh()). Empty until the engine is loaded: call refresh() first. */
  get installed() { return this.core ? this.core.installed : NONE }
  /** id -> NeuralDownload for the voices downloading (or failed) right now. */
  get downloads() { return this.core ? this.core.downloads : NO_DOWNLOADS }
  /**
   * ADDED to the contract (optional for the integration): what the voice is doing, for a "cargando voz..." hint.
   * 'idle' | 'loading' (starting the worker/model) | 'buffering' (waiting for audio to be computed) | 'speaking'.
   * Fires 'status' on this engine when it changes.
   */
  get status() { return this.core ? this.core.status : 'idle' }
  /** Read-only bridge diagnostics do not preload the engine or create a worker. */
  getDiagnosticState() {
    return this.core?.getDiagnosticState() ?? { loaded:false, moduleLoading:Boolean(this.loading), queuedRequests:this.queue.length, status:'idle',
      run:false, job:false, prepared:'none', workerAlive:false, currentUnit:null, entryCount:0, queued:0, synth:0, done:0, started:0, ended:0, deferred:0,
      gateOpen:false, buffered:false, scheduledChunks:0, availableChunks:0, timers:{pump:false,feed:false,hold:false,idle:false} }
  }
  /** ADDED: {rtf, underruns, firstAudioMs, cacheHits, prefetchHits, tooSlow} (diagnostics). */
  get stats() { return this.core ? this.core.stats : { rtf: 0, underruns: 0, firstAudioMs: 0, cacheHits: 0, prefetchHits:0, tooSlow: 0 } }

  /** ADDED: starts loading the engine code (not the worker, not a model). Call it when the picker opens or a neural voice is chosen. Resolves when it is ready. */
  preload() {
    return this.loading ||= Promise.all([import('./engine.js'), import('./client-plan.js')]).then(async ([{ NeuralEngine }, { VoiceClientPlan }]) => {
      // Requested voice code owns its small voice-domain planner. The cold
      // facade has no WASM dependency, Worker or model before this explicit use.
      const plan = this.plan ||= new VoiceClientPlan(() => new Error('Voice released'), this.resourceToken)
      for (;;) {
        const attempt = plan.capture()
        try { await plan.ready(); break }
        catch (error) { if (plan.pending(attempt)) throw error }
      }
      const core = new NeuralEngine(this.options)
      core.addEventListener('change', () => this.dispatchEvent(new Event('change')))
      core.addEventListener('status', () => this.dispatchEvent(new Event('status')))
      this.core = core
      // Browser callbacks remain handles; Rust owns ordered admission and
      // cancellation once readiness allows the bootstrap queue to be adopted.
      const tasks = new Map()
      for (const task of this.queue.splice(0)) {
        const id = plan.next('handle'); tasks.set(id, task); plan.enqueue(id)
      }
      try {
        for (let id = plan.take(); !Number.isNaN(id); id = plan.take()) {
          const task = tasks.get(id); tasks.delete(id)
          if (plan.workerActive(id)) { plan.cancel(id); task(core) }
        }
      } finally { plan.clearQueue() }
      return core
    }).catch(error => { this.loading = null; throw error })
  }

  /** Re-reads Cache Storage; fires 'change' when the installed set differs. */
  async refresh() { return (await this.preload()).refresh() }
  /**
   * Downloads a voice (model + config) from Hugging Face into Cache Storage with progress ('change' events and
   * `downloads`), asks for persistent storage, and resolves when it is usable. Rejects with an Error whose `code` is
   * 'offline' | 'http' | 'storage' | 'aborted' ('unsupported' for an unknown voice or a browser without the pieces). Never starts by itself: only the user asks for a download.
   * The base URL is https://huggingface.co/rhasspy/piper-voices/resolve/main/ unless window.INHOUSE_NEURAL_VOICE_BASE (an https URL, or http on localhost) was set before the app started: it is read once at load, later changes are ignored.
   */
  async install(id, { signal } = {}) { return (await this.preload()).install(id, { signal }) }
  /** ADDED: aborts the download of `id` (also when another speaker of the same model started it); the install() promise rejects with code 'aborted'. */
  cancel(id) { this.core?.cancel(id) }
  /** Deletes a downloaded voice. If it is the one being read, the current id gets an 'error' event with reason 'not-installed' (stop() itself fires none). */
  async remove(id) { return (await this.preload()).remove(id) }
  /** Explicit playback preparation only: loads the worker and voice model before speak(). Opening or pausing a reader must not call this. */
  async warmUp(voiceId) {
    if (this.core) return this.core.warmUp(voiceId)
    const generation = this.plan ? this.plan.capture() : {ticket:this.resourceToken,generation:0}
    const core = await this.preload()
    if (!this.current(generation)) return false
    return core.warmUp(voiceId)
  }
  async prime(request) {
    const generation = this.plan ? this.plan.capture() : {ticket:this.resourceToken,generation:0}
    const core = await this.preload()
    if (!this.current(generation)) return false
    return core.prime(request)
  }
  // A release while the module loaded replaced the resource ticket (and invalidated the plan).
  current(generation) { return this.plan ? this.plan.current(generation) : generation.ticket === this.resourceToken }
  /** Call synchronously inside a user gesture (the play tap): creates/resumes the AudioContext. */
  unlock({ playback = true } = {}) {
    const env = this.options.env || globalThis
    if (playback || !nativePcmBridge(env)) unlockAudio(env)
    this.preload().catch(() => {}) // speak() follows: have the engine code on its way
  }
  /**
   * Speaks `text` with an installed voice and returns at once. Progress is reported on `window` as
   * CustomEvent('inhouse-tts', {detail:{type, id, reason?}}) exactly like the Android bridge:
   *   'start'       the first sample of THIS text is audible now (drives the sentence highlight),
   *   'done'        it finished playing,
   *   'error'       it cannot be spoken (detail.reason: 'not-installed' | 'init-failed' | 'synth-failed'),
   *   'interrupted' playback was stopped from outside (not by stop()).
   * `upcoming` are the next fragments the reader will ask for, same voice and rate: the engine synthesises them while
   * this one plays so the voice is gapless. Calling speak() again replaces whatever was playing, except that asking for
   * what the engine already prepared (the next fragment, same voice and rate) just continues without a gap.
   */
  speak(request) {
    if (this.core) return this.core.speak(request)
    this.queue.push(core => core.speak(request))
    this.preload().catch(() => {
      this.queue.length = 0
      stopNativeAudio()
      queueMicrotask(() => (this.options.env || globalThis).dispatchEvent?.(new CustomEvent('inhouse-tts', { detail: { type: 'error', id: request.id, reason: 'init-failed' } })))
    })
  }
  /** Adds deferred page fragments only to a running core; it never starts playback or loads one. */
  extendUpcoming(request) { return this.core?.extendUpcoming(request) ?? false }
  /** Stops playback and drops queued synthesis; fires no event for the cancelled id. Frees the workers after an idle spell (~90 s). */
  stop() {
    this.queue.length = 0
    this.plan?.clearQueue()
    if (this.core) return this.core.stop()
    stopNativeAudio()
  }
  // Explicit reader close: never load the module/client or wait for native disposal.
  release() {
    this.resourceToken = {}
    this.plan?.invalidate()
    this.queue.length = 0
    if (this.core) this.core.release()
    else stopNativeAudio()
  }
  pause() {
    this.queue.length = 0
    this.plan?.clearQueue()
    if (this.core) return this.core.pause()
    pauseNativeAudio()
  }
  cancelCurrent() { this.queue.length = 0; this.plan?.clearQueue(); this.core?.cancelCurrent() }
}

let shared = null
/** The one engine of the app (tests replace it with setNeuralEngine). */
export const getNeuralEngine = () => shared || (shared = new NeuralVoiceEngine())
export const setNeuralEngine = engine => { shared = engine }
