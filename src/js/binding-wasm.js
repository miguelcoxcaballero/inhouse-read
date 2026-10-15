import { resolveHostMath } from './host-math.js';

// Host adapter for the curved binding (rust-core/src/binding.rs). The core plans the profile and
// builds the mesh; the engine's Math answers the sines, cosines and lengths it asks for, in two
// rounds. Owned output arrays survive WASM growth, recursive relief sampling and disposal of
// every scratch allocation.
const align8 = bytes => Math.ceil(bytes / 8) * 8;

export function rustBindingBuffers(core, width, height, thickness, segments = 96, relief = null, reliefRows = 384) {
  if (!core?.binding_mesh || !core.binding_plan_a || !core.memory || !core.alloc_f64 || !core.free_f64) return null;
  const rows = relief ? reliefRows : 1, vertices = (segments + 1) * (rows + 1);
  if (![width, height, thickness].every(value => Number.isFinite(value) && value > 0)
    || !Number.isInteger(segments) || segments < 1 || segments > 512
    || !Number.isInteger(rows) || rows < 1 || rows > 1024
    || vertices > 200_000 || relief && typeof relief !== 'function') return null;
  const regions = {};
  let size = 0;
  const take = (name, bytes) => { regions[name] = size; size += align8(bytes); };
  take('params', 5 * 8); take('coefficients', (segments + 1) * 5 * 8);
  take('askedA', (segments + 1) * 2 * 3 * 8); take('answeredA', (segments + 1) * 2 * 8);
  take('askedB', (segments + 1) * 3 * 8); take('answeredB', (segments + 1) * 8);
  take('relief', relief ? vertices * 8 : 0);
  take('positions', vertices * 3 * 4); take('normals', vertices * 3 * 4); take('uvs', vertices * 2 * 4);
  const indexCount = segments * rows * 6;
  take('indices', indexCount * 4);
  const length = size / 8;
  let pointer;
  try { pointer = core.alloc_f64(length); }
  catch { return null; } // Allocation failed before any relief callback ran.
  if (!pointer) return null;
  const at = name => pointer + regions[name];
  try {
    new Float64Array(core.memory.buffer, at('params'), 5).set([width, height, thickness, segments, rows]);
    const first = core.binding_plan_a(at('params'), at('askedA'));
    if (!first) return null;
    resolveHostMath(core, at('askedA'), at('answeredA'), first);
    const second = core.binding_plan_b(at('params'), at('answeredA'), at('coefficients'), at('askedB'));
    resolveHostMath(core, at('askedB'), at('answeredB'), second);
    let buffer = core.memory.buffer;
    if (relief) {
      let samples = new Float64Array(buffer, at('relief'), vertices);
      for (let i = 0; i <= segments; i++) for (let j = 0; j <= rows; j++) {
        // Preserve the callback's order and exact coordinates. It may call
        // another kernel which grows memory; refresh before writing its value.
        const value = relief(i / segments, j / rows);
        if (buffer !== core.memory.buffer) {
          buffer = core.memory.buffer;
          samples = new Float64Array(buffer, at('relief'), vertices);
        }
        samples[i * (rows + 1) + j] = value;
      }
    }
    core.binding_finish(at('params'), at('answeredB'), at('coefficients'), relief ? at('relief') : 0,
      at('positions'), at('normals'), at('uvs'), at('indices'));
    buffer = core.memory.buffer;
    // Three reserves index 65535 for primitive restart, so 65535 must use u32.
    const indexSource = new Uint32Array(buffer, at('indices'), indexCount);
    return {
      positions:new Float32Array(new Float32Array(buffer, at('positions'), vertices * 3)),
      normals:new Float32Array(new Float32Array(buffer, at('normals'), vertices * 3)),
      uvs:new Float32Array(new Float32Array(buffer, at('uvs'), vertices * 2)),
      indices:vertices - 1 >= 65535 ? new Uint32Array(indexSource) : new Uint16Array(indexSource),
      normalVersion:relief ? 1 : 0,
    };
  } finally { core.free_f64(pointer, length); }
}
