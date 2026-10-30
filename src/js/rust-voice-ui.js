import init, * as glue from '../wasm/voice/inhouse_read_voice_ui.js'
// The voice kernels as the synthesis worker and the Android client call them (rust-ui, `voice` feature): one instance per
// realm, kept on the realm itself so every copy of this file uses the same one. The rules of the voice have no JavaScript
// twin: a module that cannot load is an error to report, never a state to work around.
const SLOT = Symbol.for('inhouse-read.voice-ui')
let loading = null

export const getRustVoiceUI = () => globalThis[SLOT] || null

/** Loads the module once per realm (`module`: an already compiled WebAssembly.Module, as the unit tests hand it over). */
export function loadRustVoiceUI({ module } = {}) {
  if (globalThis[SLOT]) return Promise.resolve(globalThis[SLOT])
  loading ||= init(module ? { module_or_path:module } : undefined).then(() => {
    if (glue.voice_ui_abi_version() !== 1) throw new Error('Incompatible Rust voice module')
    return (globalThis[SLOT] ||= glue)
  }).finally(() => { loading = null })
  return loading
}

export async function requireRustVoiceUI() {
  try { return await loadRustVoiceUI() } catch { throw new Error('El módulo de voz no se pudo cargar. Recarga la página.') }
}

/** The voice module of a realm that already awaited requireRustVoiceUI() (the voice core's loader awaits both). */
export function loadedRustVoiceUI() {
  const voice = globalThis[SLOT]
  if (!voice) throw new Error('El módulo de voz no está cargado.')
  return voice
}
