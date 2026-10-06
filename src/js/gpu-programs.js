import * as THREE from 'three';

// three links every shader program with a synchronous driver round trip the
// first time an object using it is drawn, so a first frame with ~50 programs
// stalls the main thread for one link after another. It also deletes a
// program as soon as its last material is disposed, so quality swaps, flyout
// closes and reader closes relink the same shaders later. This module links
// the programs of a scene in parallel (KHR_parallel_shader_compile, polled
// without blocking) before its first frame and keeps linked programs alive.

// Programs are bounded by the distinct material/light variants of the app;
// the cap only protects the GPU from a runaway variant source.
const MAX_RETAINED = 160;
// A driver that never reports completion must not hold the first frame back.
const LINK_TIMEOUT = 15000;
const retained = new WeakSet();
const retainedCounts = new WeakMap();
const preparedUniforms = new WeakSet();

// Linking alone does not reflect a program's uniforms. Three does that lazily
// on its first draw, including for page/board faces hidden by the closed cover.
// Prepare those same programs while the cover waits, one per idle slice. This
// neither draws hidden surfaces nor changes shader variants or their quality.
export async function prepareProgramUniforms(renderer, materials, { idle, current = () => true } = {}) {
  if (typeof idle !== 'function' || !materials || !renderer.properties?.get) return false;
  const programs = new Set();
  for (const material of materials)
    renderer.properties.get(material).programs?.forEach(program => programs.add(program));
  const deadline = performance.now() + LINK_TIMEOUT;
  for (const program of programs) {
    if (preparedUniforms.has(program) || typeof program.getUniforms !== 'function') continue;
    do {
      await idle();
      if (!current()) return false;
      if (performance.now() > deadline) return false;
    } while (typeof program.isReady === 'function' && !program.isReady());
    program.getUniforms();
    preparedUniforms.add(program);
  }
  return current();
}

// Page warm-up compiles hidden leaf materials too. Submit that exact batch
// before the idle readiness checks, without waiting for completion or drawing.
export function compilePagePrograms(renderer, scene, camera) {
  const materials = renderer.compile(scene, camera);
  if (materials?.size) renderer.getContext?.()?.flush?.();
  return materials;
}

/** Pin every program the renderer currently holds so disposing the last
 * material that used one no longer deletes it. */
export function retainPrograms(renderer) {
  const programs = renderer.info.programs;
  let retainedCount = retainedCounts.get(renderer) || 0;
  for (let index = 0; index < programs.length && retainedCount < MAX_RETAINED; index++) {
    const program = programs[index];
    if (retained.has(program)) continue;
    retained.add(program); retainedCount++;
    program.usedTimes++;
  }
  retainedCounts.set(renderer,retainedCount);
}

/** three offers no program-cache hook: pin whatever each render created. */
export function keepProgramsAlive(renderer) {
  const render = renderer.render;
  renderer.render = function (scene, camera) {
    render.call(this, scene, camera);
    retainPrograms(this);
  };
}

const materialsOf = object => Array.isArray(object.material) ? object.material : [object.material];
const drawable = object => (object.isMesh || object.isPoints || object.isLine) && object.material;

// renderer.compile() traverses every node, visible or not (a hidden floor, a
// culled book). Hand it only the objects the next frame can draw.
const listing = objects => ({ traverse: callback => objects.forEach(callback), traverseVisible: () => {} });

/** Start linking the programs of the visible meshes under `roots` without
 * waiting for them. A scene built part by part then links each part while
 * the next one is still being made. Its lights and environment must already
 * be final, or the next frame links other variants. */
export function prelinkPrograms(renderer, scene, camera, roots) {
  if (typeof renderer.compile !== 'function' || renderer.getRenderTarget() !== null) return;
  const drawn = [];
  for (const root of roots) root.traverseVisible(object => { if (drawable(object)) drawn.push(object); });
  if (!drawn.length) return;
  renderer.compile(listing(drawn), camera, scene);
  // Hand the queued compiles to the driver now, not at the next sync point.
  renderer.getContext?.().flush?.();
}

/** Start linking every program `scene` draws in parallel. Returns a cheap
 * `ready()` predicate, false while any link is still running (for at most
 * LINK_TIMEOUT, after which the first draw links what is left). The scene's
 * lights and environment must already be configured. `prepared` can include
 * hidden meshes that must be ready with it. Without the extension, programs
 * report ready at once and link on the first draw as before. */
export function compilePrograms(renderer, scene, camera, prepared = []) {
  if (typeof renderer.compile !== 'function') return () => true;
  const programs = new Set();
  const compile = objects => {
    for (const material of renderer.compile(listing(objects), camera, scene))
      renderer.properties.get(material).programs?.forEach(program => programs.add(program));
  };
  const drawn = [];
  scene.traverseVisible(object => { if (drawable(object)) drawn.push(object); });
  for (const object of prepared) if (!drawn.includes(object)) drawn.push(object);
  compile(drawn);
  // Glass makes three draw the opaque scene a second time into a linear
  // half-float target, which needs its own variant of every program.
  if (drawn.some(object => materialsOf(object).some(material => material.transmission > 0))) {
    const previous = renderer.getRenderTarget();
    const target = new THREE.WebGLRenderTarget(1, 1, { type:THREE.HalfFloatType });
    renderer.setRenderTarget(target);
    try { compile(drawn.filter(object => materialsOf(object).every(material => !material.transmission && !material.transparent))); }
    finally { renderer.setRenderTarget(previous); target.dispose(); }
  }
  // Submit the complete batch before polling, just as prelinkPrograms does.
  // This queues the work without waiting for links or drawing a first frame.
  if (programs.size) renderer.getContext?.().flush?.();
  const deadline = performance.now() + LINK_TIMEOUT;
  return () => {
    if (performance.now() > deadline) return true;
    for (const program of programs) if (!program.isReady()) return false;
    return true;
  };
}

/** Link the programs of `object` (normally still hidden in `scene`) in
 * parallel and call `done` once they are ready, polling between frames so a
 * new catalogue model never stalls the main thread on a synchronous link.
 * Runs `done` at once when nothing is pending. Returns a cancel function. */
export function whenProgramsReady(renderer, scene, camera, object, done, { interval = 16 } = {}) {
  const meshes = [];
  object.traverse(node => { if ((node.isMesh || node.isPoints || node.isLine) && node.material) meshes.push(node); });
  let ready, timer = 0, cancelled = false;
  try { ready = compilePrograms(renderer, scene, camera, meshes); } catch { ready = () => true; }
  const check = () => {
    timer = 0;
    if (cancelled) return;
    if (ready()) { cancelled = true; done(); } else timer = setTimeout(check, interval);
  };
  check();
  return () => { cancelled = true; if (timer) clearTimeout(timer); timer = 0; };
}
