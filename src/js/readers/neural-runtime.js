// The reader's single doorway to the on-device neural voice engine (neural-voice/index.js).
// The engine is imported lazily and every call here is guarded: if the module cannot load (offline chunk, old WebView) or
// misbehaves, reading reports the failure and can retry. Nothing downloads from here.
import { normalizeNeuralVoice } from './voice-catalog.js'
import { neuralVoices } from './neural-voice/catalog.js'
import { unlockAudio } from './neural-voice/audio.js'

let engineModule = null, loading = null

/**
 * Tests (and only tests) may hand the page a prepared engine and catalogue before the app starts:
 * window.__inhouseNeuralTest = { engine, voices }. Without that global this does nothing.
 */
function applyTestHook(loaded) {
  const hook = globalThis.__inhouseNeuralTest
  if (!hook) return
  if (hook.engine) loaded.setNeuralEngine(hook.engine)
  if (Array.isArray(hook.voices)) loaded.neuralVoices.splice(0, loaded.neuralVoices.length, ...hook.voices)
}

/** Loads the engine module once; resolves to it, or to null when it cannot be loaded (a later call tries again). */
export function loadNeural() {
  if (engineModule) return Promise.resolve(engineModule)
  loading ||= import('./neural-voice/index.js').then(loaded => { applyTestHook(loaded); engineModule = loaded; return loaded }, () => null).then(result => { loading = null; return result })
  return loading
}

/** The engine when its module is loaded and this device can run it, else null. Safe to call from anywhere, any time. */
export function neuralEngine() {
  try {
    const engine = engineModule?.getNeuralEngine()
    return engine && engine.supported ? engine : null
  } catch { return null }
}

/** The natural catalogue is available before the heavy engine loads; only its installed state depends on that engine. */
export function neuralVoiceList(engine = neuralEngine()) {
  try {
    const installed = engine?.installed || []
    return (engineModule?.neuralVoices || neuralVoices).map(entry => normalizeNeuralVoice(entry, installed)).filter(Boolean)
  } catch { return [] }
}

/** True when at least one neural voice is downloaded: only then does the page need an unlocked AudioContext. */
export function neuralReady(engine = neuralEngine()) {
  try { return Boolean(engine && (engine.installed?.size || engine.downloads?.size)) } catch { return false }
}

/** Creates/resumes the engine's AudioContext. Call synchronously inside a user gesture; never throws. */
export function unlockNeural() {
  try { const engine = neuralEngine(); if (engine) engine.unlock(); else unlockAudio() } catch { /* a later tap can unlock audio again */ }
}
