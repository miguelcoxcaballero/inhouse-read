import * as THREE from 'three';
import { getRustCore } from './rust-core.js';
import { needRustShelf } from './rust-shelf.js';

// Parameter and result lengths of the Rust rig (rust-core/src/shelf_lighting.rs). The fit itself (penumbra
// width, slack of a screen beyond each edge, the aspect limit that keeps the blur round on tall phone screens),
// the shadow map's settings, the firmer variance light-bleed floor and the back panel's Vogel disk are decided
// in Rust (the core's rig and rust-ui/src/shelf_light_rig.rs).
const PARAMS = 47, OUTPUT = 19;
// Patched once, before any shelf program is compiled; a later three simply skips it.
function firmVarianceShadows() {
  const chunk = THREE.ShaderChunk.shadowmap_pars_fragment;
  const patched = chunk ? needRustShelf().shelf_firm_bleed(chunk) : undefined;
  if (patched !== undefined) THREE.ShaderChunk.shadowmap_pars_fragment = patched;
}

/** Soft, wide shelf shadows and dimmer room bounce for the cabinet's back
 * panel only, so each shelf's shadow fades out instead of ending in a hard
 * band; boards, books and plants keep their tighter contact shadows. Guarded
 * string patches: a later three without these lines compiles stock shaders. */
export function widePenumbra(material) {
  // Phones shade many more device pixels: fewer taps, fixed for the session.
  const shelf = needRustShelf(), taps = shelf.shelf_panel_taps();
  material.defines = { ...material.defines, PANEL_TAPS:taps };
  material.onBeforeCompile = shader => {
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <shadowmap_pars_fragment>', `#include <shadowmap_pars_fragment>\n${shelf.shelf_panel_shadow(taps)}`)
      .replace('#include <lights_fragment_begin>', THREE.ShaderChunk.lights_fragment_begin
        .replace('getShadow( directionalShadowMap[ i ]', 'getPanelShadow( directionalShadowMap[ i ]'))
      // Deep inside the carcass, sides and shelves hide much of the room:
      // its bounce and reflections reach the panel dimmed.
      .replace('#include <aomap_fragment>', `#include <aomap_fragment>
        reflectedLight.indirectDiffuse *= .8; reflectedLight.indirectSpecular *= .72;`);
  };
  material.customProgramCacheKey = () => 'walnut-panel-penumbra';
  return material;
}

/** A single soft key shadow, fitted in light space to the part of the cabinet
 * around the camera window rather than to its whole scroll height. The
 * variance map is only redrawn (and blurred) when something changed or the
 * view scrolled beyond the fitted window's slack. */
export function createShelfLighting(scene, renderer) {
  const key = scene.userData.readerLight;
  if (!key) return { update:() => false, settling:false, dispose() {} };
  const core = getRustCore();
  if (typeof core?.shelf_light_update !== 'function') throw new Error('Shelf lighting needs the Rust core');
  if (core.shelf_light_params() !== PARAMS || core.shelf_light_output() !== OUTPUT) throw new Error('Incompatible Rust shelf lighting');
  firmVarianceShadows();
  // The rig's own direction; the light is only moved along it.
  const toLight = key.position.clone().sub(key.target.position).normalize();
  const [mapSize, bias, normalBias, radius, restSamples, movingSamples, intensity] = needRustShelf().shelf_light_rig();
  key.castShadow = true;
  key.shadow.mapSize.set(mapSize, mapSize);
  key.shadow.bias = bias;
  key.shadow.normalBias = normalBias;
  // The radius (in texels) follows the fit. Each sample count compiles its two
  // small blur programs once; three caches both.
  let coarse = false;
  key.shadow.radius = radius;
  key.shadow.blurSamples = restSamples;
  key.shadow.intensity = intensity;
  key.shadow.autoUpdate = false;
  scene.add(key.target);
  // The Rust rig decides when the window is refitted, when a pure similarity of the view
  // moves the existing map, and the new frustum. Its parameters and results cross as numbers.
  const rig = core.shelf_light_new(), length = PARAMS + OUTPUT, arena = core.alloc_f64(length);
  if (!rig || !arena) { if (rig) core.shelf_light_free(rig); throw new Error('Shelf lighting could not allocate'); }
  let released = false, buffer = null, input = null, output = null;
  const views = () => {
    if (buffer !== core.memory.buffer) {
      buffer = core.memory.buffer;
      input = new Float64Array(buffer, arena, PARAMS); output = new Float64Array(buffer, arena + PARAMS * 8, OUTPUT);
    }
  };
  const camera = key.shadow.camera;
  const update = options => {
    if (released) return false;
    const { width, viewportHeight, depth, bounds = null, moving = false, transform = null, forceRefit = false } = options;
    const { scroll } = options, dirtyValue = options.dirty === undefined ? true : options.dirty;
    views();
    input[0] = width; input[1] = viewportHeight; input[2] = depth; input[3] = scroll;
    input[4] = bounds ? 1 : 0;
    if (bounds) input.set([bounds.min.x, bounds.min.y, bounds.min.z, bounds.max.x, bounds.max.y, bounds.max.z], 5);
    input[11] = transform ? 1 : 0;
    if (transform) input.set(transform.elements, 12);
    input[28] = moving ? 1 : 0; input[29] = forceRefit ? 1 : 0; input[30] = dirtyValue ? 1 : 0;
    input.set([toLight.x, toLight.y, toLight.z, key.position.x, key.position.y, key.position.z,
      key.target.position.x, key.target.position.y, key.target.position.z, key.shadow.normalBias,
      camera.left, camera.right, camera.top, camera.bottom, camera.near, camera.far], 31);
    if (core.shelf_light_update(rig, arena, arena + PARAMS * 8) !== 1) throw new Error('Rust shelf lighting rejected its frame');
    views();
    const [dirty, assigned, refit, transported, settling] = output;
    if (refit || transported) {
      key.position.set(output[5], output[6], output[7]);
      key.target.position.set(output[8], output[9], output[10]);
      key.shadow.normalBias = output[11];
      Object.assign(camera, { left:output[12], right:output[13], top:output[14], bottom:output[15], near:output[16], far:output[17] });
      camera.updateProjectionMatrix();
      key.updateMatrixWorld(); key.target.updateMatrixWorld();
      // three normally updates this while rendering the map. With a cached
      // map the new lookup matrix is sufficient; no depth or blur pass runs.
      if (transported) key.shadow.updateMatrices(key);
      if (refit) key.shadow.radius = output[18];
    }
    coarse = Boolean(settling);
    if (dirty) {
      key.shadow.blurSamples = coarse ? movingSamples : restSamples;
      key.shadow.needsUpdate = true; renderer.shadowMap.needsUpdate = true;
    }
    return assigned ? true : dirtyValue;
  };
  return { update,
    /** A map drawn in motion still awaits its full-quality redraw. */
    get settling() { return coarse; },
    dispose() {
      key.shadow.map?.dispose(); key.shadow.mapPass?.dispose();
      if (!released) { released = true; core.free_f64(arena, length); core.shelf_light_free(rig); }
    } };
}
