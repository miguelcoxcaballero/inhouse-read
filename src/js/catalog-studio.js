import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createCatalogPreviewFrame } from './catalog-preview-frame.js';
import { retainPrograms, whenProgramsReady } from './gpu-programs.js';
import { configureShaderDiagnostics } from './shader-diagnostics.js';
import { needRustShelf } from './rust-shelf.js';

export const PLANT_STUDIO = 0, SHELF_STUDIO = 1, LAMP_STUDIO = 2;

/** The three.js side of one catalogue studio (rust-ui/src/catalog_studio.rs decides its loop, its lights and
 * when anything is built or drawn; rust-ui/src/studio_build.rs makes its scene, orthographic camera, renderer,
 * studio environment and lights): the resize observer and the draw itself. `adapter` adds the studio's own
 * `make`, `swap`, `retint`, `tintSet` and `release`. Returns the native state and the parts. */
export function openStudio(kind, host, adapter) {
  const shelf = needRustShelf();
  const parts = shelf.studio_parts(THREE, RoomEnvironment, kind, host, adapter, createCatalogPreviewFrame(), configureShaderDiagnostics,
    event => { event.preventDefault(); if (!state.disposed) shelf.studio_unavailable(host); });
  const { renderer, scene, camera } = parts;
  const studio = {
    make:adapter.make, swap:adapter.swap, retint:adapter.retint, tintSet:adapter.tintSet,
    link:(model, done) => whenProgramsReady(renderer, scene, camera, adapter.linkRoot?.(model) ?? model, done),
    draw(model) {
      // Layout size: the page may be scaled mid-flight, its drawing buffer not.
      const rect = host.clientWidth ? { width:host.clientWidth, height:host.clientHeight } : host.getBoundingClientRect();
      parts.framing.apply(camera, renderer, rect, adapter.size(model), adapter.padding);
      adapter.beforeDraw?.(model);
      renderer.render(scene, camera);
      // Going back to an earlier selection reuses its linked shaders.
      if (renderer.info) retainPrograms(renderer);
      host.dataset.renderCount = String(Number(host.dataset.renderCount || 0) + 1);
    },
    unframe:() => parts.framing.dispose(),
    finish(model) {
      parts.observer?.disconnect(); adapter.release(model, parts);
      parts.environment?.dispose(); renderer?.dispose(); renderer?.forceContextLoss();
      host.replaceChildren();
    }
  };
  const state = shelf.studio_open(kind, studio, host, Boolean(renderer), {
    render:shelf.studio_render, build:shelf.studio_build, visibility:shelf.studio_visibility,
    invalidate:shelf.studio_invalidate, reveal:shelf.studio_shown, swap:shelf.studio_swap });
  if (renderer) { parts.observer = new ResizeObserver(state.invalidate); parts.observer.observe(host); }
  return { state, parts, shelf };
}

/** The preview API the catalogue drives, on top of a studio's native state. */
export function studioControls({ state, shelf }, update) {
  return {
    setActive:value => shelf.studio_set_active(state, value),
    update,
    dispose:() => shelf.studio_dispose(state)
  };
}
