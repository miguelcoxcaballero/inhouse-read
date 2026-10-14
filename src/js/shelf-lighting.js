import * as THREE from 'three';
import { getRustCore } from './rust-core.js';

const SHADOW_SIZE = 1024;
// Parameter and result lengths of the Rust rig (rust-core/src/shelf_lighting.rs).
const PARAMS = 47, OUTPUT = 19;
// The fit itself (penumbra width, slack of a screen beyond each edge, the aspect limit that
// keeps the blur round on tall phone screens) is decided in the Rust rig.
const compactScreen = () => Math.min(globalThis.innerWidth || 1024, globalThis.innerHeight || 1024) < 600;
// three's variance shadows keep a 0.3 light-bleed floor. Books standing a
// finger's width from the back panel, under a shelf far above them, need a
// firmer one or a lit halo opens between the two shadows. Patched once,
// before any shelf program is compiled; a later three simply skips it.
const BLEED = '( softness_probability - 0.3 ) / ( 0.95 - 0.3 )';
function firmVarianceShadows() {
  const chunk = THREE.ShaderChunk.shadowmap_pars_fragment;
  if (chunk?.includes(BLEED)) THREE.ShaderChunk.shadowmap_pars_fragment = chunk.replace(BLEED,
    '( softness_probability - 0.62 ) / ( 0.97 - 0.62 )');
}

// The back panel stands a whole shelf depth behind every board, where a
// window's shadow arrives with a wide penumbra: it averages the (already
// blurred) map over a Vogel disk this many blur radii across.
const PANEL_REACH = 3.6;
// Every pixel uses the same Vogel disk, so its taps reach the shader as
// constants (radius and angle evaluated here) instead of a sqrt, cos and sin
// per tap and pixel.
const panelShadow = taps => `
#ifdef USE_SHADOWMAP
float getPanelShadow( sampler2D map, vec2 size, float intensity, float bias, float radius, vec4 coord ) {
  // Taps slide along the panel itself (screen derivatives of the shadow
  // coordinate), so a wide disk never compares against the panel's own slope.
  float reach = radius * ${PANEL_REACH.toFixed(2)} / size.x;
  vec3 du = dFdx( coord.xyz ), dv = dFdy( coord.xyz );
  du *= reach / max( length( du.xy ), 1e-7 ); dv *= reach / max( length( dv.xy ), 1e-7 );
  float sum = 0.0;
${Array.from({ length:taps }, (_, k) => {
    const r = Math.sqrt((k + .5) / taps), a = k * 2.39996 + .4;
    return `  sum += getShadow( map, size, intensity, bias, radius, coord + vec4( ${(r * Math.cos(a)).toFixed(8)} * du + ${
      (r * Math.sin(a)).toFixed(8)} * dv, 0.0 ) );`;
  }).join('\n')}
  return sum / float( PANEL_TAPS );
}
#endif`;

/** Soft, wide shelf shadows and dimmer room bounce for the cabinet's back
 * panel only, so each shelf's shadow fades out instead of ending in a hard
 * band; boards, books and plants keep their tighter contact shadows. Guarded
 * string patches: a later three without these lines compiles stock shaders. */
export function widePenumbra(material) {
  // Phones shade many more device pixels: fewer taps, fixed for the session.
  const taps = compactScreen() ? 9 : 12;
  material.defines = { ...material.defines, PANEL_TAPS:taps };
  material.onBeforeCompile = shader => {
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <shadowmap_pars_fragment>', `#include <shadowmap_pars_fragment>\n${panelShadow(taps)}`)
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
  key.castShadow = true;
  key.shadow.mapSize.set(SHADOW_SIZE, SHADOW_SIZE);
  // Variance maps need only a small constant bias; a modest normal offset
  // keeps grazing boards free of acne without detaching books (peter-panning).
  key.shadow.bias = -.0004;
  key.shadow.normalBias = .45;
  // A window is an area light: wide, even penumbrae under every shelf. The
  // radius (in texels) follows the fit; fewer taps suffice on phone screens.
  // While anything moves the map is redrawn (and blurred) every frame: half
  // the taps then, and one full-quality redraw once the scene settles. Each
  // count compiles its two small blur programs once; three caches both.
  const restSamples = compactScreen() ? 8 : 12, movingSamples = restSamples / 2;
  let coarse = false;
  key.shadow.radius = 9;
  key.shadow.blurSamples = restSamples;
  // Room bounce never lets a shelf shadow go fully black.
  key.shadow.intensity = .84;
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
