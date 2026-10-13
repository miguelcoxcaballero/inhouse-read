import { reloadOnceAfterChunkFailure } from './chunk-recovery.js'
import { waitForRustUI } from './rust-ui.js'

/**
 * The IKEA catalogue (dialog, drawings, three.js previews) is only needed once
 * somebody taps the catalogue button, so its code is a separate chunk that is
 * prefetched when the shelf has settled. Same surface as createPlantCatalog.
 * The Rust UI module draws the whole catalogue, so the chunk counts as loaded
 * only when that module is too: a tap waits for it as it waits for the chunk.
 */
let modulePromise = null, loadedModule = null
export function loadPlantCatalogModule() {
  // Only a failed chunk import is a stale-deploy symptom worth a reload; a Rust
  // module that cannot load leaves the catalogue unavailable until a later tap.
  return modulePromise ||= Promise.all([
    import('./plant-catalog.js').catch(error => { reloadOnceAfterChunkFailure(); throw error }),
    waitForRustUI()
  ]).then(([module]) => loadedModule = module).catch(error => { modulePromise = null; throw error })
}

export function createLazyPlantCatalog(options = {}) {
  let catalog = null, loading = null, destroyed = false, shelfType = options.shelfType
  const create = module => catalog ||= module.createPlantCatalog({ ...options, shelfType })
  // Once the chunk is in (prefetched, or opened before) a new shelf gets its
  // catalogue straight away, exactly as before.
  if (loadedModule) try { create(loadedModule) } catch (error) { console.warn('No se pudo preparar el catálogo:', error) }
  const load = () => loading ||= loadPlantCatalogModule().then(module => destroyed ? null : create(module))
    .catch(error => { loading = null; throw error })
  return {
    prefetch() { return load().catch(() => null) },
    /** Idle-time: also build the first studio so the first open only draws. */
    prepare() { return load().then(target => { if (!destroyed) target?.prepare?.() }).catch(() => null) },
    async open(from = document.activeElement) {
      let target
      try { target = catalog || await load() } catch (error) { console.warn('No se pudo abrir el catálogo:', error); return }
      if (destroyed || !target) return
      target.setShelfType(shelfType)
      target.open(from)
    },
    setShelfType(value) { shelfType = value; catalog?.setShelfType(value) },
    destroy() { destroyed = true; catalog?.destroy(); catalog = null }
  }
}
