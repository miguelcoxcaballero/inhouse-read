import initShelf, * as shelfModule from '../wasm/shelf/inhouse_read_shelf.js'

// The live shelf's pointer controllers (the `shelf` build of rust-ui). Unlike the reader
// components in rust-ui.js they are needed from the shelf's first frame on, so the page
// head starts fetching and compiling the module (index.html) while the app modules load,
// and the first shelf render awaits it. The module is small; a ready one costs nothing.
let shelf = null
let loading = null
let retryAfter = 0
const FAILED_RETRY_DELAY_MS = 30_000

export const getRustShelf = () => shelf

/** Load once per JS realm, adopting the head's compiled module when there is one. */
export function loadRustShelf() {
  if (shelf) return Promise.resolve(shelf)
  if (loading) return loading
  if (Date.now() < retryAfter) return Promise.resolve(null)
  const early = globalThis.__inhouseShelfReady
  if (early) delete globalThis.__inhouseShelfReady
  loading = (async () => {
    if (typeof WebAssembly !== 'object') return null
    // A failed early compile (null) falls back to the module's own fetch.
    const compiled = early ? await early : null
    await initShelf(compiled ? { module_or_path: compiled } : undefined)
    if (shelfModule.shelf_abi_version() !== 1) throw new Error('Incompatible Rust shelf module')
    shelf = shelfModule
    retryAfter = 0
    return shelf
  })().catch(() => {
    retryAfter = Date.now() + FAILED_RETRY_DELAY_MS
    return null
  }).finally(() => { loading = null })
  return loading
}

/** For the first shelf render: the controllers have no JavaScript twin, so a module that
 * cannot load is an error to report, not a state to work around. */
export async function requireRustShelf() {
  const ready = await loadRustShelf()
  if (!ready) throw new Error('El módulo de la estantería no se pudo cargar. Recarga la página.')
  return ready
}
