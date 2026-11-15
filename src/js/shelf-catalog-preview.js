import * as THREE from 'three';
import { createBaggebo } from './baggebo-model.js';
import { createShelfFurniture } from './shelf-furniture.js';
import { normalizeShelfType, WALNUT_SPEC } from './shelf-types.js';
import { openStudio, studioControls, SHELF_STUDIO } from './catalog-studio.js';

const WALNUT = new URL('../assets/library/walnut-pbr.webp',import.meta.url).href;
const WALNUT_SURFACE = new URL('../assets/library/walnut-surface.webp',import.meta.url).href;

/** The same cabinet geometry as the library, lit and rendered only on demand.
 * When to build, show or draw, the studio's lights per type, and the model itself (the walnut's
 * materials, the cabinet, its place, and what goes when the studio closes) are Rust
 * (rust-ui/src/catalog_studio.rs), from what `rig` hands over. */
export function createShelfCatalogPreview(host) {
  const rig = { three:THREE, maps:[WALNUT,WALNUT_SURFACE], spec:WALNUT_SPEC, createBaggebo, createShelfFurniture,
    size:null, walnut:null, textures:[], materials:[] };
  const studio = openStudio(SHELF_STUDIO, host, { padding:1.14, rig,
    size:model => rig.size ||= new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3()) });
  const { state, shelf } = studio;
  return studioControls(studio, ({ shelfType }) => shelf.studio_update_shelf(state, normalizeShelfType(shelfType)));
}
