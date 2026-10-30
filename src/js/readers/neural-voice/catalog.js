// Curated Piper voices (rhasspy/piper-voices, VITS models) and where to download them from. Only voices that were proven
// end to end with their real weights are listed. The models, their speakers and the records the picker reads are the voice
// catalogue of the app core (rust-core/src/voice_catalogue.rs), awaited like the core itself: this file is imported by the
// app at start-up (the voice picker needs the list), so it stays tiny and free of the engine.

import { VOICE_CATALOGUE, isSupertonicVoiceId, supertonicVoicesFor } from './supertonic-catalog.js'

/** Voice ids are namespaced so they never collide with Android/browser voice ids. */
export const NEURAL_PREFIX = 'piper:'
export const isNeuralVoiceId = id => typeof id === 'string' && (id.startsWith(NEURAL_PREFIX) || isSupertonicVoiceId(id))

/** Where the models live. Tests and mirrors set window.INHOUSE_NEURAL_VOICE_BASE before the app starts (see neuralVoiceBase). */
export const DEFAULT_VOICE_BASE = VOICE_CATALOGUE.piperBase

// A downloaded model is loaded into onnxruntime, so where it comes from is not negotiable at run time: the override must be
// https (or http on this very machine, for the test mirror) and is read ONCE, when this module loads at the start of the app.
// Anything a book's own script sets on window later (an EPUB's inline script runs with the page's origin) is ignored.
const trustedBase = url => {
  try { const { protocol, hostname } = new URL(url); return protocol === 'https:' || (protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(hostname)) } catch { return false }
}
const overrideOf = env => { const value = env?.INHOUSE_NEURAL_VOICE_BASE; return typeof value === 'string' && trustedBase(value) ? value : '' }
const OVERRIDE_AT_LOAD = overrideOf(globalThis)

/** The base URL (always ending in '/') every model, config and the voices.json catalogue is fetched from. `env` is for tests: any other object is read as it is now. */
export function neuralVoiceBase(env = globalThis) {
  const base = (env === globalThis ? OVERRIDE_AT_LOAD : overrideOf(env)) || DEFAULT_VOICE_BASE
  return base.endsWith('/') ? base : base + '/'
}

/**
 * One entry per voice a person can pick: a model with several speakers gives one entry per speaker (they share the one
 * downloaded model). The id of speaker 0 is 'piper:<piperId>', the others 'piper:<piperId>#<speaker>'.
 * `models` below groups them by model.
 * @type {import('./index.js').NeuralVoice[]}
 */
export const piperVoices = VOICE_CATALOGUE.piperVoices
// Multilingual profiles use generic language tags. They do not claim an
// Argentine, Mexican, Portuguese or other regional accent.
export const supertonicVoices = supertonicVoicesFor(piperVoices.map(voice => voice.lang))
export const neuralVoices = [...piperVoices, ...supertonicVoices]

/** piperId -> the voices (speakers) that share that model. */
export const modelsOf = voices => {
  const map = new Map()
  for (const voice of voices) (map.get(voice.piperId) || map.set(voice.piperId, []).get(voice.piperId)).push(voice)
  return map
}
