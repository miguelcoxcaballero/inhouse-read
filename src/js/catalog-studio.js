import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createCatalogPreviewFrame } from './catalog-preview-frame.js';
import { retainPrograms, whenProgramsReady } from './gpu-programs.js';
import { configureShaderDiagnostics } from './shader-diagnostics.js';
import { needRustShelf } from './rust-shelf.js';

export const PLANT_STUDIO = 0, SHELF_STUDIO = 1, LAMP_STUDIO = 2;

// The other modules' functions the studio's set-up calls.
const hooks = { createCatalogPreviewFrame, whenProgramsReady, retainPrograms, configureShaderDiagnostics };

/** One catalogue studio. Its three.js side (the scene, the orthographic camera, the renderer with its studio
 * environment and lights, the resize observer and the draw) and its loop are rust-ui/src/catalog_studio.rs
 * (studio_open_three, studio_open). `adapter` adds the studio's own `make`, `swap`, `retint`, `tintSet` and
 * `release`. Returns the native state and the parts. */
export function openStudio(kind, host, adapter) {
  const shelf = needRustShelf();
  return shelf.studio_open_three(kind, host, adapter, THREE, RoomEnvironment, hooks, shelf);
}

/** The preview API the catalogue drives, on top of a studio's native state. */
export function studioControls({ state, shelf }, update) {
  return {
    setActive:value => shelf.studio_set_active(state, value),
    update,
    dispose:() => shelf.studio_dispose(state)
  };
}
