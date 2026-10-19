import * as THREE from 'three';
import { createShelfPlant } from './shelf-plants.js';
import { openStudio, studioControls, PLANT_STUDIO } from './catalog-studio.js';

/** One stationary front view. Render only for selection, resize or texture updates.
 * A new selection is built after the tapped choice has painted and is shown
 * once its shaders are linked in parallel; the previous plant stays meanwhile.
 * When to build, show, recolour or draw is decided in Rust (rust-ui/src/catalog_studio.rs). */
export function createPlantCatalogPreview(host) {
  let modelSize = null;
  const studio = openStudio(PLANT_STUDIO, host, {
    padding:1.14,
    make(selection, _stage, _previous, invalidate) {
      const next = createShelfPlant({ ...selection, seed:`catalog:${selection.catalogId}` });
      next.userData.invalidate = invalidate; next.visible = false; studio.parts.scene.add(next);
      return next;
    },
    swap(previous, next, selection) {
      if (previous) { studio.parts.scene.remove(previous); previous.userData.dispose(); }
      next.visible = true; modelSize = null;
      host.dataset.modelCatalogId = selection.catalogId;
    },
    // Texture completion changes the surface, never this stationary geometry.
    size:model => modelSize ||= new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3()),
    release:model => model?.userData.dispose()
  });
  const { state, shelf } = studio;
  return { ...studioControls(studio, selection => shelf.studio_update_plant(state, selection)),
    /** Build the queued plant and link its shaders now, even while hidden. */
    prepare:() => shelf.studio_prepare(state) };
}
