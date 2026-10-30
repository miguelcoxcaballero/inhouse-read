import * as THREE from 'three';
import { cachedStudioEnvironment, prepareStudioEnvironmentCache } from './studio-environment-cache.js';
import { configureShaderDiagnostics } from './shader-diagnostics.js';
import { keepProgramsAlive } from './gpu-programs.js';
import { needRustShelf } from './rust-shelf.js';

// Immutable room generation lives independently of book appearance and motion.
// Its build revision includes this module, its dependencies and the Three engine.
const rendererEnvironments = new WeakMap();
export function createStudioRenderer(preserveDrawingBuffer = false) {
  if (!globalThis.WebGLRenderingContext && !globalThis.WebGL2RenderingContext) return null;
  // The renderer, its tone mapping and shadows, and the studio room it reflects: rust-ui/src/studio_environment.rs.
  const made = needRustShelf().studio_renderer_create(THREE, preserveDrawingBuffer,
    { cachedStudioEnvironment, prepareStudioEnvironmentCache, configureShaderDiagnostics, keepProgramsAlive });
  if (made) rendererEnvironments.set(made.renderer, made.environment);
  return made;
}


export const studioEnvironmentFor = renderer => rendererEnvironments.get(renderer);
