import { reloadOnceAfterChunkFailure } from './chunk-recovery.js'

/**
 * The IKEA catalogue (dialog, drawings, three.js previews) is only needed once
 * somebody taps the catalogue button, so its code is a separate chunk that is
 * prefetched when the shelf has settled. Same surface as createPlantCatalog.
 */
let modulePromise = null, loadedModule = null
export function loadPlantCatalogModule() {
  return modulePromise ||= import('./plant-catalog.js').then(module => loadedModule = module)
    .catch(error => { modulePromise = null; reloadOnceAfterChunkFailure(); throw error })
}

export function createLazyPlantCatalog(options = {}) {
  let catalog = null, loading = null, destroyed = false, shelfType = options.shelfType
  const create = module => catalog ||= module.createPlantCatalog({ ...options, shelfType })
  // Once the chunk is in (prefetched, or opened before) a new shelf gets its
  // catalogue straight away, exactly as before.
  if (loadedModule) create(loadedModule)
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
