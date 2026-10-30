import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createCatalogPreviewFrame } from './catalog-preview-frame.js';
import { retainPrograms, whenProgramsReady } from './gpu-programs.js';
import { configureShaderDiagnostics } from './shader-diagnostics.js';
import { needRustShelf } from './rust-shelf.js';

export const PLANT_STUDIO = 0, SHELF_STUDIO = 1, LAMP_STUDIO = 2;

/** The three.js side of one catalogue studio (rust-ui/src/catalog_studio.rs decides its loop, its lights and
 * when anything is built or drawn): the scene, the orthographic camera, the renderer with its studio
 * environment and lights, the resize observer and the draw itself. `adapter` adds the studio's own
 * `make`, `swap`, `retint`, `tintSet` and `release`. Returns the native state and the parts. */
export function openStudio(kind, host, adapter) {
  const shelf = needRustShelf(), plan = shelf.studio_plan(kind);
  const scene = new THREE.Scene();
  const [left, right, top, bottom, near, far, ...stand] = plan.camera;
  const camera = new THREE.OrthographicCamera(left, right, top, bottom, near, far);
  if (stand.length) { camera.position.set(...stand); camera.lookAt(0, 0, 0); }
  const parts = { scene, camera, renderer:null, environment:null, lights:{}, framing:createCatalogPreviewFrame(), observer:null };
  adapter.prepareScene?.(parts);
  const unavailable = () => { host.dataset.renderer = 'unavailable'; host.textContent = 'Vista 3D no disponible'; };
  try {
    if (typeof WebGLRenderingContext === 'undefined') throw new Error('WebGL unavailable');
    const renderer = parts.renderer = new THREE.WebGLRenderer({ antialias:true, alpha:true });
    configureShaderDiagnostics(renderer);
    renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = plan.exposure;
    if (plan.shadows) {
      renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      // Main-camera resize and reopening do not move these stationary casters.
      renderer.shadowMap.autoUpdate = false;
    }
    renderer.domElement.setAttribute('aria-hidden', 'true');
    renderer.domElement.addEventListener('webglcontextlost', event => { event.preventDefault(); if (!state.disposed) unavailable(); });
    const pmrem = new THREE.PMREMGenerator(renderer), room = new RoomEnvironment();
    if (plan.cards.length) {
      const cardMaterial = new THREE.MeshBasicMaterial({ color:'#252a30', side:THREE.DoubleSide });
      for (const [x, y, z, width, height] of plan.cards) {
        const card = new THREE.Mesh(new THREE.PlaneGeometry(width, height), cardMaterial);
        card.position.set(x, y, z); card.lookAt(0, y, 0); room.add(card);
      }
    }
    parts.environment = pmrem.fromScene(room, plan.sigma); room.dispose(); pmrem.dispose();
    scene.environment = parts.environment.texture; scene.environmentIntensity = plan.environment;
    const hemisphere = parts.lights.hemisphere = new THREE.HemisphereLight(plan.sky, plan.ground, plan.hemisphere); scene.add(hemisphere);
    const key = parts.lights.key = new THREE.DirectionalLight(plan.key.color, plan.key.intensity); key.position.set(...plan.key.position);
    if (plan.shadow) {
      const [shadowLeft, shadowRight, shadowTop, shadowBottom, shadowNear, shadowFar] = plan.shadow.camera;
      if (plan.shadow.cast) key.castShadow = true;
      key.shadow.mapSize.set(plan.shadow.mapSize, plan.shadow.mapSize);
      Object.assign(key.shadow.camera, { left:shadowLeft, right:shadowRight, top:shadowTop, bottom:shadowBottom, near:shadowNear, far:shadowFar });
      if (plan.shadow.project) key.shadow.camera.updateProjectionMatrix();
      key.shadow.bias = plan.shadow.bias; key.shadow.normalBias = plan.shadow.normalBias;
    }
    scene.add(key);
    const fill = parts.lights.fill = new THREE.DirectionalLight(plan.fill.color, plan.fill.intensity); fill.position.set(...plan.fill.position); scene.add(fill);
    host.replaceChildren(renderer.domElement); host.dataset.renderer = 'three-mesh';
  } catch {
    parts.renderer?.dispose(); parts.renderer = null; parts.environment?.dispose(); parts.environment = null; unavailable();
  }
  const { renderer } = parts;
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
