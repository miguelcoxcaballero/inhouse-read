import { getRustUI, requireRustUI } from './rust-ui.js'
import { shelfPresented } from './idle-startup.js'

// The cloud, library-backup and Drive logic lives in the Rust UI module. It
// is background work: with the module not loaded yet, nothing here starts its
// download before the shelf has drawn its first live frame, and nothing
// reaches the shelf's own path. There is no JavaScript copy to fall back to; a
// module that cannot load is reported the way the other cores report it.
const MESSAGE = 'No se pudo cargar la sincronización. Comprueba la conexión e inténtalo de nuevo.'

/** The loaded Rust UI module, waiting (once) for the first shelf frame. */
export async function cloudModule() {
  const loaded = getRustUI()
  if (loaded) return loaded
  await shelfPresented()
  const ui = getRustUI() || await requireRustUI()
  if (!ui) throw new Error(MESSAGE)
  return ui
}

/** The module if it is already in memory; callers that need an answer now. */
export const loadedCloudModule = () => getRustUI()
