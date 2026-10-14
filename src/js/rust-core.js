import coreUrl from '../wasm/inhouse_read_core.wasm?url'
import {createRustLoader} from './rust-loader.js'
import {registerStudioScanCore} from './studio-scan-state.js'
const loader = createRustLoader(coreUrl, '__inhouseRustReady', 0, registerStudioScanCore)
export const getRustCore = loader.get
export const loadRustCore = loader.load
/** For the first shelf render: the numeric core has no JavaScript twin there, so a core that
 * cannot load is an error to report, not a state to work around. */
export async function requireRustCore() {
  const core = await loader.load()
  if (!core) throw new Error('El módulo numérico no se pudo cargar. Recarga la página.')
  return core
}
