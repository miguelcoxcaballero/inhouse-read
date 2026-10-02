// On-device neural voices (Piper VITS models run by onnxruntime-web inside a Web Worker, played with Web Audio).
// Free, unlimited and offline once a voice is downloaded; nothing is sent anywhere. This file is the CONTRACT between
// the engine and the reading integration (reading-voice.js, voice-catalog.js, the voice picker): the integration only
// imports from here.
//
// The app imports this file at start-up (the picker needs the catalogue), so everything here is tiny: the catalogue, the
// AudioContext unlock, and a facade that loads the real engine (engine.js, with the downloader, the player and the worker
// client) with a dynamic import the first time it is needed. The worker, onnxruntime-web and the phonemizer are loaded
// even later, on the first speak(), inside the worker. Nothing of this reaches the cold start of the 3D shelf.
import { NEURAL_PREFIX, isNeuralVoiceId, neuralVoices } from './catalog.js'
import { unlockAudio } from './audio.js'

export { NEURAL_PREFIX, isNeuralVoiceId, neuralVoices }

/**
 * Curated catalogue (see catalog.js), best default of each language first.
 * @typedef {object} NeuralVoice
 * @property {string} id         'piper:es_MX-claude-high' ('piper:<piperId>#<speaker>' for the 2nd+ speaker of a model)
 * @property {string} piperId    'es_MX-claude-high' (the Hugging Face rhasspy/piper-voices file stem)
 * @property {string} lang       BCP-47 tag, 'es-MX'
 * @property {string} name       person/brand name shown in the picker, 'Claude'
 * @property {'medium'|'high'} quality
 * @property {number} sizeMB     download size, ~63
 * @property {number} speaker    speaker id inside the model (0 for single-speaker models)
 * @property {boolean} [recommended]  the one to offer first for its language
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
    return typeof env.Worker === 'function' && typeof env.WebAssembly === 'object' && !!(env.AudioContext || env.webkitAudioContext) && !!env.caches
  }

  /** @param {object} [options] dependencies handed to the real engine (tests inject fakes; see engine.js) */
  constructor(options = {}) {
    super()
    this.options = options
    this.core = null
    this.loading = null
    this.queue = []
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
  /** ADDED: {rtf, underruns, firstAudioMs, cacheHits, tooSlow} of the voice so far (diagnostics). */
  get stats() { return this.core ? this.core.stats : { rtf: 0, underruns: 0, firstAudioMs: 0, cacheHits: 0, tooSlow: 0 } }

  /** ADDED: starts loading the engine code (not the worker, not a model). Call it when the picker opens or a neural voice is chosen. Resolves when it is ready. */
  preload() {
    return this.loading ||= import('./engine.js').then(({ NeuralEngine }) => {
      const core = new NeuralEngine(this.options)
      core.addEventListener('change', () => this.dispatchEvent(new Event('change')))
      core.addEventListener('status', () => this.dispatchEvent(new Event('status')))
      this.core = core
      for (const task of this.queue.splice(0)) task(core)
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
  /** ADDED: loads the worker and the voice's model ahead of the first speak() (cold start 3-6 s). Call it when a book opens with a neural voice selected. Never rejects. */
  async warmUp(voiceId) { return (await this.preload()).warmUp(voiceId) }
  /** Call synchronously inside a user gesture (the play tap): creates/resumes the AudioContext. */
  unlock() {
    unlockAudio(this.options.env || globalThis)
    this.preload().catch(() => {}) // speak() follows: have the engine code on its way
  }
  /**
   * Speaks `text` with an installed voice and returns at once. Progress is reported on `window` as
   * CustomEvent('inhouse-tts', {detail:{type, id, reason?}}) exactly like the Android bridge:
   *   'start'       the first sample of THIS text is audible now (drives the sentence highlight),
   *   'done'        it finished playing,
   *   'error'       it cannot be spoken (detail.reason: 'too-slow' | 'not-installed' | 'init-failed' | 'synth-failed'),
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
      queueMicrotask(() => (this.options.env || globalThis).dispatchEvent?.(new CustomEvent('inhouse-tts', { detail: { type: 'error', id: request.id, reason: 'init-failed' } })))
    })
  }
  /** Stops playback and drops queued synthesis; fires no event for the cancelled id. Frees the workers after an idle spell (~90 s). */
  stop() {
    if (this.core) return this.core.stop()
    this.queue.length = 0
  }
}

let shared = null
/** The one engine of the app (tests replace it with setNeuralEngine). */
export const getNeuralEngine = () => shared || (shared = new NeuralVoiceEngine())
export const setNeuralEngine = engine => { shared = engine }
