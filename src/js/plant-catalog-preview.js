import { createShelfPlant } from './shelf-plants.js';
import { openStudio, studioControls, PLANT_STUDIO } from './catalog-studio.js';

/** One stationary front view. Render only for selection, resize or texture updates.
 * A new selection is built after the tapped choice has painted and is shown
 * once its shaders are linked in parallel; the previous plant stays meanwhile.
 * All of it is decided and done in Rust (rust-ui/src/catalog_studio.rs); the plant's builder stays here. */
export function createPlantCatalogPreview(host) {
  const studio = openStudio(PLANT_STUDIO, host, { padding:1.14, createShelfPlant });
  const { state, shelf } = studio;
  return { ...studioControls(studio, selection => shelf.studio_update_plant(state, selection)),
    /** Build the queued plant and link its shaders now, even while hidden. */
    prepare:() => shelf.studio_prepare(state) };
}
