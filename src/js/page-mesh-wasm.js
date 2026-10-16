import { resolveHostMath } from './host-math.js';

// Host adapter of the page block and the turned leaves (rust-core/src/page_mesh.rs). The core
// plans each mesh and builds it; the engine's Math answers the powers and hypotenuses it asks
// for, in two rounds (the second needs the first). Every result owns its arrays and every
// scratch arena is freed before returning.
const align8 = bytes => Math.ceil(bytes / 8) * 8;
const available = (core, kernel) => typeof core?.[kernel] === 'function'
  && core.memory && typeof core.alloc_f64 === 'function' && typeof core.free_f64 === 'function';

/** `stages`: the plan's two stages and its finish; `counts`: what each stage reads and writes. */
function withMesh(core, stages, params, counts, groups) {
  const { vertices, indexCount, coefficients, requestsA, requestsB } = counts;
  const regions = {};
  let size = 0;
  const take = (name, bytes) => { regions[name] = size; size += align8(bytes); };
  take('params', params.length * 8); take('coefficients', coefficients * 8);
  take('askedA', requestsA * 3 * 8); take('answeredA', requestsA * 8); take('askedB', requestsB * 3 * 8); take('answeredB', requestsB * 8);
  take('positions', vertices * 3 * 4); take('normals', vertices * 3 * 4); take('uvs', vertices * 2 * 4);
  take('colors', vertices * 3 * 4); take('indices', indexCount * 2);
  const length = size / 8;
  let pointer;
  try { pointer = core.alloc_f64(length); } catch { return null; }
  if (!pointer) return null;
  const at = name => pointer + regions[name];
  try {
    new Float64Array(core.memory.buffer, pointer, params.length).set(params);
    const first = core[stages[0]](at('params'), at('askedA'));
    if (!first) return null; // sizes the plan does not take
    resolveHostMath(core, at('askedA'), at('answeredA'), first);
    const second = core[stages[1]](at('params'), at('answeredA'), at('coefficients'), at('askedB'));
    resolveHostMath(core, at('askedB'), at('answeredB'), second);
    core[stages[2]](at('params'), at('answeredB'), at('coefficients'), at('positions'), at('normals'), at('uvs'), at('colors'), at('indices'));
    const buffer = core.memory.buffer;
    return {
      positions:new Float32Array(new Float32Array(buffer, at('positions'), vertices * 3)),
      normals:new Float32Array(new Float32Array(buffer, at('normals'), vertices * 3)),
      uvs:new Float32Array(new Float32Array(buffer, at('uvs'), vertices * 2)),
      colors:new Float32Array(new Float32Array(buffer, at('colors'), vertices * 3)),
      indices:new Uint16Array(new Uint16Array(buffer, at('indices'), indexCount)), groups,
    };
  } catch { return null; } // Pure numeric operation; the caller reports a mesh that cannot be built.
  finally { core.free_f64(pointer, length); }
}

const STAGES = ['page_block_plan_a', 'page_block_plan_b', 'page_block_finish'];
const LEAF_STAGES = ['leaf_stack_plan_a', 'leaf_stack_plan_b', 'leaf_stack_finish'];

export function rustPageBlockBuffers(core, width, height, thickness,
  { board = height * .007, inset = height * .009, detail = false } = {}) {
  if (!available(core, 'page_block_mesh') || !available(core, 'page_block_plan_a')) return null;
  const columns = detail ? 16 : 8, rows = detail ? 6 : 3;
  const vertices = 2 * (columns + 1) * (rows + 1) + 2 * (columns + 1) + 8;
  const indexCount = columns * rows * 12 + columns * 6 + 12;
  return withMesh(core, STAGES, [width, height, thickness, board, inset, detail ? 1 : 0], {
    vertices, indexCount, coefficients:(columns + 1) * 3 + rows + 1, requestsA:1 + (columns + 1) + (rows + 1), requestsB:columns + 1
  }, [{ start:0, count:indexCount, materialIndex:0 }]);
}

export function rustLeafStackBuffers(core, width, height, depth,
  { board = height * .007, inset = height * .009, columns = 14 } = {}) {
  if (!available(core, 'leaf_stack_mesh') || !available(core, 'leaf_stack_plan_a')
    || !Number.isInteger(columns) || columns < 1 || columns > 512) return null;
  const vertices = 6 * (columns + 1) + 4, indexCount = columns * 18 + 6, faceCount = columns * 6;
  return withMesh(core, LEAF_STAGES, [width, height, depth, board, inset, columns], {
    vertices, indexCount, coefficients:(columns + 1) * 3, requestsA:columns + 1, requestsB:columns + 1
  }, [{ start:0, count:faceCount, materialIndex:0 }, { start:faceCount, count:indexCount - faceCount, materialIndex:1 }]);
}
