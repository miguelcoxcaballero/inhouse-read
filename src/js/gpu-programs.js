import * as THREE from 'three';
import { needRustShelf } from './rust-shelf.js';

// Rust owns program selection, deduplication, retention, readiness deadlines,
// idle reflection and background parking. Three/WebGL objects stay in the host.
let bindings;
function host() {
  const rust = needRustShelf();
  return bindings ||= {
    compileList(renderer, objects, camera, scene) {
      return renderer.compile({ traverse:callback => objects.forEach(callback), traverseVisible() {} }, camera, scene);
    },
    createTarget:() => new THREE.WebGLRenderTarget(1, 1, { type:THREE.HalfFloatType }),
    // Keep bulk membership of opaque Three handles in their owning runtime;
    // Rust processes only new handles and owns their retention policy.
    unretained:(programs, retained) => programs.filter(program => !retained.has(program)),
    collect:rust.gpu_collect_drawable, ready:rust.gpu_programs_ready,
    uniformAfterIdle:rust.gpu_uniform_after_idle,
    check:rust.gpu_readiness_check, wake:rust.gpu_readiness_wake, cancel:rust.gpu_readiness_cancel,
  };
}

export async function prepareProgramUniforms(renderer, materials, { idle, current = () => true } = {}) {
  return needRustShelf().gpu_prepare_uniforms(host(), renderer, materials, idle, current);
}
export function compilePagePrograms(renderer, scene, camera) {
  return needRustShelf().gpu_compile_page(renderer, scene, camera);
}
export function retainPrograms(renderer) {
  return needRustShelf().gpu_retain_programs(host(), renderer);
}
export function keepProgramsAlive(renderer) {
  const render = renderer.render;
  renderer.render = function(scene, camera) {
    render.call(this, scene, camera);
    retainPrograms(this);
  };
}
export function prelinkPrograms(renderer, scene, camera, roots) {
  return needRustShelf().gpu_prelink(host(), renderer, scene, camera, roots);
}
export function compilePrograms(renderer, scene, camera, prepared = []) {
  return needRustShelf().gpu_compile_programs(host(), renderer, scene, camera, prepared);
}
export function whenProgramsReady(renderer, scene, camera, object, done, { interval = 16 } = {}) {
  return needRustShelf().gpu_when_ready(host(), renderer, scene, camera, object, done, interval);
}
