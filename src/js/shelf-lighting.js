import * as THREE from 'three';
import { getRustCore } from './rust-core.js';
import { needRustShelf } from './rust-shelf.js';
import { prepareProgramUniforms } from './gpu-programs.js';

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

// three keeps its variance-shadow blur material to itself, and its built shader text is not exported.
// The first map a renderer blurs hands that material to `renderBufferDirect`, where it is seen once and
// the hook removed; the shelf links its moving-frame blur from a copy (createShelfLighting).
let blurTemplate = null;
const watchedRenderers = new WeakSet();
function seeBlur(renderer) {
  const direct = renderer?.renderBufferDirect;
  if (blurTemplate || typeof direct !== 'function' || watchedRenderers.has(renderer)) return;
  watchedRenderers.add(renderer);
  const watch = function(camera, scene, geometry, material, object, group) {
    if (!blurTemplate && material?.isShaderMaterial && material.defines && 'VSM_SAMPLES' in material.defines &&
      !('HORIZONTAL_PASS' in material.defines)) {
      // Its map is a render target's texture, which three refuses to clone: the copy reads none.
      const pass = material.uniforms?.shadow_pass;
      const map = pass?.value;
      if (pass) pass.value = null;
      try { blurTemplate = material.clone(); } finally { if (pass) pass.value = map; }
    }
    if (blurTemplate && renderer.renderBufferDirect === watch) renderer.renderBufferDirect = direct;
    return direct.call(this, camera, scene, geometry, material, object, group);
  };
  renderer.renderBufferDirect = watch;
}

/** Soft, wide shelf shadows and dimmer room bounce for the cabinet's back
 * panel only, so each shelf's shadow fades out instead of ending in a hard
 * band; boards, books and plants keep their tighter contact shadows. Guarded
 * string patches: a later three without these lines compiles stock shaders. */
export function widePenumbra(material) {
  // Phones shade many more device pixels: fewer taps, fixed for the session.
  const shelf = needRustShelf(), taps = shelf.shelf_panel_taps();
  material.defines = { ...material.defines, PANEL_TAPS:taps };
  // The three guarded patches are Rust (shelf_panel_fragment); three's light chunk is read when the program compiles.
  material.onBeforeCompile = shader => { shader.fragmentShader = shelf.shelf_panel_fragment(shader.fragmentShader, THREE.ShaderChunk.lights_fragment_begin, taps); };
  const key = shelf.shelf_panel_key();
  material.customProgramCacheKey = () => key;
  return material;
}

/** A single soft key shadow, fitted in light space to the part of the cabinet
 * around the camera window rather than to its whole scroll height. The
 * variance map is only redrawn (and blurred) when something changed or the
 * view scrolled beyond the fitted window's slack. */
export function createShelfLighting(scene, renderer) {
  const key = scene.userData.readerLight;
  if (!key) return { update:() => false, prepareMotion:async () => false, settling:false, dispose() {} };
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
    if (bounds) {
      input[5] = bounds.min.x; input[6] = bounds.min.y; input[7] = bounds.min.z;
      input[8] = bounds.max.x; input[9] = bounds.max.y; input[10] = bounds.max.z;
    }
    input[11] = transform ? 1 : 0;
    if (transform) input.set(transform.elements, 12);
    input[28] = moving ? 1 : 0; input[29] = forceRefit ? 1 : 0; input[30] = dirtyValue ? 1 : 0;
    input[31] = toLight.x; input[32] = toLight.y; input[33] = toLight.z;
    input[34] = key.position.x; input[35] = key.position.y; input[36] = key.position.z;
    input[37] = key.target.position.x; input[38] = key.target.position.y; input[39] = key.target.position.z;
    input[40] = key.shadow.normalBias;
    input[41] = camera.left; input[42] = camera.right;
    input[43] = camera.top; input[44] = camera.bottom;
    input[45] = camera.near; input[46] = camera.far;
    if (core.shelf_light_update(rig, arena, arena + PARAMS * 8) !== 1) throw new Error('Rust shelf lighting rejected its frame');
    views();
    const dirty = output[0], assigned = output[1], refit = output[2], transported = output[3], settling = output[4];
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
  // The coarser blur a moving frame draws (half the samples) is a pair of programs of its own, otherwise
  // linked by the first frame of the first turn or drag. Link them ahead, idle, from copies of three's
  // blur material (same text, same defines in the same order; see seeBlur) compiled while a render target
  // is bound, as the shadow pass binds one: three finds them in its program cache when the motion begins.
  // The copies stay alive, so their programs stay linked.
  if (movingSamples !== restSamples) seeBlur(renderer);
  let motionBlur = null;
  async function prepareMotion(room, view, idle, current = () => true) {
    if (released || motionBlur || movingSamples === restSamples || typeof renderer.compileAsync !== 'function') return false;
    // The first paint (which blurs the first map) follows the call; a few idle slices at most.
    for (let slice = 0; !blurTemplate && slice < 8; slice++) {
      await idle();
      if (released || motionBlur || !current()) return false;
    }
    if (!blurTemplate) return false;
    const vertical = blurTemplate.clone();
    vertical.defines = { ...vertical.defines, VSM_SAMPLES:movingSamples };
    const horizontal = vertical.clone(); horizontal.defines.HORIZONTAL_PASS = 1;
    const triangle = new THREE.BufferGeometry();
    triangle.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, .5, 3, -1, .5, -1, 3, .5]), 3));
    const pair = new THREE.Group(), probe = new THREE.WebGLRenderTarget(1, 1);
    for (const material of [vertical, horizontal]) { const mesh = new THREE.Mesh(triangle, material); mesh.frustumCulled = false; pair.add(mesh); }
    motionBlur = { materials:[vertical, horizontal], triangle };
    await idle();
    if (released || !current()) return false;
    const bound = renderer.getRenderTarget(), face = renderer.getActiveCubeFace(), level = renderer.getActiveMipmapLevel();
    let linked;
    renderer.setRenderTarget(probe);
    try { linked = renderer.compileAsync(pair, view, room); } finally { renderer.setRenderTarget(bound, face, level); probe.dispose(); }
    await linked;
    if (released || !current()) return false;
    return prepareProgramUniforms(renderer, motionBlur.materials, { idle, current:() => !released && current() });
  }
  return { update, prepareMotion,
    /** A map drawn in motion still awaits its full-quality redraw. */
    get settling() { return coarse; },
    dispose() {
      key.shadow.map?.dispose(); key.shadow.mapPass?.dispose();
      if (motionBlur) { for (const material of motionBlur.materials) material.dispose(); motionBlur.triangle.dispose(); }
      if (!released) { released = true; core.free_f64(arena, length); core.shelf_light_free(rig); }
    } };
}
