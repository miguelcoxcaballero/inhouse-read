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

// renderer.compile() traverses every node, visible or not (a hidden floor, a
// culled book). Hand it only the objects the next frame can draw.
const listing = objects => ({ traverse: callback => objects.forEach(callback), traverseVisible: () => {} });

/** Start linking every program `scene` draws in parallel. Returns a cheap
 * `ready()` predicate, false while any link is still running (for at most
 * LINK_TIMEOUT, after which the first draw links what is left). The scene's
 * lights and environment must already be configured. `prepared` can include
 * hidden interaction meshes that must be ready before the first gesture.
 * Without the extension, programs report ready at once and link on the
 * first draw as before. */
export function compilePrograms(renderer, scene, camera, prepared = []) {
  if (typeof renderer.compile !== 'function') return () => true;
  const programs = new Set();
  const compile = objects => {
    for (const material of renderer.compile(listing(objects), camera, scene))
      renderer.properties.get(material).programs?.forEach(program => programs.add(program));
  };
  const drawn = [];
  scene.traverseVisible(object => { if ((object.isMesh || object.isPoints || object.isLine) && object.material) drawn.push(object); });
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
  const deadline = performance.now() + LINK_TIMEOUT;
  return () => {
    if (performance.now() > deadline) return true;
    for (const program of programs) if (!program.isReady()) return false;
    return true;
  };
}
