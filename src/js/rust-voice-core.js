import voiceUrl from '../wasm/inhouse_read_voice.wasm?url'
import {createRustLoader} from './rust-loader.js'
const loader=createRustLoader(voiceUrl,'__inhouseVoiceReady',2)
export const getRustVoiceCore=loader.get
export const loadRustVoiceCore=loader.load
/** For the synthesis worker and the Android client: the voice rules have no JavaScript twin, so a core that
 * cannot load is an error to report, not a state to work around. */
export async function requireRustVoiceCore() {
  const core = await loader.load()
  if (!core) throw new Error('El módulo de voz no se pudo cargar. Recarga la página.')
  return core
}
/** The voice core of a realm that already awaited requireRustVoiceCore(). */
export function loadedRustVoiceCore() {
  const core = loader.get()
  if (!core) throw new Error('El módulo de voz no está cargado.')
  return core
}
