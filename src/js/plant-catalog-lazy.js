/**
 * The IKEA catalogue (dialog, drawings, three.js previews) is only needed once
 * somebody taps the catalogue button, so its code is a separate chunk that is
 * prefetched when the shelf has settled. Same surface as createPlantCatalog.
 */
let modulePromise = null
export function loadPlantCatalogModule() {
  return modulePromise ||= import('./plant-catalog.js').catch(error => { modulePromise = null; throw error })
}

export function createLazyPlantCatalog(options = {}) {
  let catalog = null, loading = null, destroyed = false, shelfType = options.shelfType
  const load = () => loading ||= loadPlantCatalogModule().then(module => {
    if (!destroyed && !catalog) catalog = module.createPlantCatalog({ ...options, shelfType })
    return catalog
  }).catch(error => { loading = null; throw error })
  return {
    prefetch() { return load().catch(() => null) },
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
