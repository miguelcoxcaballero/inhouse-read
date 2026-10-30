import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createCatalogPreviewFrame } from './catalog-preview-frame.js';
import { retainPrograms, whenProgramsReady } from './gpu-programs.js';
import { configureShaderDiagnostics } from './shader-diagnostics.js';
import { needRustShelf } from './rust-shelf.js';

export const PLANT_STUDIO = 0, SHELF_STUDIO = 1, LAMP_STUDIO = 2;

// A studio's draw, its one per-frame step (each frame of a lamp's colour easing): it stays here because
// reading its dozen properties across the WebAssembly boundary costs far more than the step itself.
function drawFor(host, adapter, parts, renderer) {
  const { scene, camera } = parts;
  return model => {
    // Layout size: the page may be scaled mid-flight, its drawing buffer not.
    const rect = host.clientWidth ? { width:host.clientWidth, height:host.clientHeight } : host.getBoundingClientRect();
    parts.framing.apply(camera, renderer, rect, adapter.size(model), adapter.padding);
    adapter.beforeDraw?.(model);
    renderer.render(scene, camera);
    // Going back to an earlier selection reuses its linked shaders.
    if (renderer.info) retainPrograms(renderer);
    host.dataset.renderCount = String(Number(host.dataset.renderCount || 0) + 1);
  };
}

// The other modules' functions the studio's set-up calls.
const hooks = { createCatalogPreviewFrame, whenProgramsReady, configureShaderDiagnostics, drawFor };

/** One catalogue studio. Its three.js side (the scene, the orthographic camera, the renderer with its studio
 * environment and lights, the resize observer) and its loop are rust-ui/src/catalog_studio.rs
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
