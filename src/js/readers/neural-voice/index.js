// On-device neural voices (Piper VITS models run by onnxruntime-web inside Web Workers, played with Web Audio).
// Free, unlimited and offline once a voice is downloaded; nothing is sent anywhere. This file is the CONTRACT between
// the engine and the reading integration (reading-voice.js, voice-catalog.js, the voice picker): the engine side
// replaces the stub below, keeping every export and signature; the integration side only imports from here.

/** Voice ids are namespaced so they never collide with Android/browser voice ids. */
export const NEURAL_PREFIX = 'piper:'
export const isNeuralVoiceId = id => typeof id === 'string' && id.startsWith(NEURAL_PREFIX)

/**
 * Curated catalogue, best default of each language first.
 * @typedef {object} NeuralVoice
 * @property {string} id         'piper:es_MX-claude-high'
 * @property {string} piperId    'es_MX-claude-high' (the Hugging Face rhasspy/piper-voices file stem)
 * @property {string} lang       BCP-47 tag, 'es-MX'
 * @property {string} name       person/brand name shown in the picker, 'Claude'
 * @property {'medium'|'high'} quality
 * @property {number} sizeMB     download size, ~63
 * @property {number} speaker    speaker id inside the model (0 for single-speaker models)
 * @property {boolean} [recommended]  the one to offer first for its language
 * @type {NeuralVoice[]}
 */
export const neuralVoices = []

/**
 * Download state published for the picker while a voice is being fetched.
 * @typedef {{state:'downloading'|'error', fraction:number, received:number, total:number, error?:string}} NeuralDownload
 */

export class NeuralVoiceEngine extends EventTarget {
  /** Worker + WebAssembly + AudioContext + Cache Storage are all available. */
  static isSupported(env = globalThis) { return false }
  get supported() { return NeuralVoiceEngine.isSupported() }
  /** Ids of the voices fully downloaded (kept fresh; see refresh()). */
  get installed() { return new Set() }
  /** id -> NeuralDownload for the voices downloading (or failed) right now. */
  get downloads() { return new Map() }
  /** Re-reads Cache Storage; fires 'change' when the installed set differs. */
  async refresh() {}
  /**
   * Downloads a voice (model + config) from Hugging Face into Cache Storage with progress ('change' events and
   * `downloads`), asks for persistent storage, and resolves when it is usable. Rejects with an Error whose `code` is
   * 'offline' | 'http' | 'storage' | 'aborted'. Never starts by itself: only the user asks for a download.
   */
  async install(id, { signal } = {}) { throw Object.assign(new Error('unsupported'), { code:'unsupported' }) }
  /** Deletes a downloaded voice. */
  async remove(id) {}
  /** Call synchronously inside a user gesture (the play tap): creates/resumes the AudioContext. */
  unlock() {}
  /**
   * Speaks `text` with an installed voice and returns at once. Progress is reported on `window` as
   * CustomEvent('inhouse-tts', {detail:{type, id, reason?}}) exactly like the Android bridge:
   *   'start'       the first sample of THIS text is audible now (drives the sentence highlight),
   *   'done'        it finished playing,
   *   'error'       it cannot be spoken (detail.reason: 'too-slow' | 'not-installed' | 'init-failed' | 'synth-failed'),
   *   'interrupted' playback was stopped from outside (not by stop()).
   * `upcoming` are the next fragments the reader will ask for, same voice and rate: the engine synthesises them while
   * this one plays so the voice is gapless. Calling speak() again replaces whatever was playing.
   */
  speak({ text, voiceId, rate = 1, id, upcoming = [] }) {}
  /** Stops playback and drops queued synthesis; fires no event for the cancelled id. Frees the workers after an idle spell. */
  stop() {}
}

let shared = null
/** The one engine of the app (tests replace it with setNeuralEngine). */
export const getNeuralEngine = () => shared || (shared = new NeuralVoiceEngine())
export const setNeuralEngine = engine => { shared = engine }
