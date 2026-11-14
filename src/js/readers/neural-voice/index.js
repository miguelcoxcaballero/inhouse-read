// On-device natural voices (Piper and Supertonic models run by onnxruntime-web in a Worker, played with Web Audio).
// This file is the CONTRACT between the engine and the reading integration: the integration only imports from here.
// The members of the facade are rust-ui (neural_facade.rs, which documents the contract); what stays here is what has
// to be JavaScript: the class (an EventTarget whose fields the reader and the diagnostics read), the getters the
// picker reads while it paints, and the two dynamic imports, which keep the engine out of the app's start-up.
import { NEURAL_PREFIX, isNeuralVoiceId, neuralVoices } from './catalog.js'
import { nativePcmBridge, pauseNativeAudio, stopNativeAudio, unlockAudio } from './audio.js'
import { readerUI, rustMethods } from '../rust-ui-required.js'

export { NEURAL_PREFIX, isNeuralVoiceId, neuralVoices }
export { piperVoices, supertonicVoices } from './catalog.js'

const NONE = new Set(), NO_DOWNLOADS = new Map()

export class NeuralVoiceEngine extends EventTarget {
  /** Worker + WebAssembly + AudioContext + Cache Storage are all available. */
  static isSupported(env = globalThis) { return readerUI().neural_supported(env, nativePcmBridge) }

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
  get installed() { return this.core ? this.core.installed : NONE }
  get downloads() { return this.core ? this.core.downloads : NO_DOWNLOADS }
  get status() { return this.core ? this.core.status : 'idle' }
  get stats() { return this.core ? this.core.stats : { rtf: 0, underruns: 0, firstAudioMs: 0, cacheHits: 0, prefetchHits:0, tooSlow: 0 } }
}
rustMethods(NeuralVoiceEngine, 'facade_method', 'getDiagnosticState preload !refresh !install cancel !remove !warmUp !prime current unlock speak extendUpcoming stop release pause cancelCurrent',
  { engine: () => import('./engine.js'), plan: () => import('./client-plan.js'), nativePcmBridge, pauseNativeAudio, stopNativeAudio, unlockAudio })

let shared = null
/** The one engine of the app (tests replace it with setNeuralEngine). */
export const getNeuralEngine = () => shared || (shared = new NeuralVoiceEngine())
export const setNeuralEngine = engine => { shared = engine }
