import { resolveHostMath } from './host-math.js';

// Host adapter of the ribbon (rust-core/src/bookmark.rs). The core plans the strip from the book
// and the pose and builds the mesh; the engine's Math answers what it asks (two rounds, the
// second needing the first). One arena per section count is reused for every frame, with no
// per-frame arrays or Vector3 objects. The views of a result are scratch: copy them before the
// next call.
const states = new WeakMap();
const align8 = size => Math.ceil(size / 8) * 8;

function refreshViews(state, core) {
  if (state.buffer === core.memory.buffer) return;
  state.buffer = core.memory.buffer;
  state.positions = new Float32Array(state.buffer, state.pointer + state.positionsOffset, state.count * 12);
  state.uvs = new Float32Array(state.buffer, state.pointer + state.uvsOffset, state.count * 8);
  state.normals = new Float32Array(state.buffer, state.pointer + state.normalsOffset, state.count * 12);
}

function obtainState(core, steps) {
  let cache = states.get(core);
  if (!cache) states.set(core, cache = new Map());
  let state = cache.get(steps);
  if (state) { refreshViews(state, core); return state; }
  const count = steps + 1, indexCount = steps * 24 + 12, asked = 1 + 7 * count;
  let size = 0;
  const take = bytes => { const at = size; size += align8(bytes); return at; };
  const layout = {
    params: take(9 * 8), crowd: take(64 * 8), coefficients: take(count * 7 * 8), distances: take(count * 8),
    requests: take(asked * 3 * 8), results: take(asked * 8), twistRequests: take(count * 2 * 3 * 8), twistResults: take(count * 2 * 8),
    positions: take(count * 12 * 4), uvs: take(count * 8 * 4), normals: take(count * 12 * 4), indices: take(indexCount * 2)
  };
  const length = size / 8;
  const pointer = core.alloc_f64(length);
  if (!pointer || pointer + size > core.memory.buffer.byteLength) throw new Error('Ribbon allocation failed');
  try {
    core.bookmark_topology(pointer + layout.indices, steps);
    // The powers the crowding of the fold uses depend on the section count alone.
    const crowd = core.bookmark_constants(steps, pointer + layout.requests);
    if (!crowd) throw new RangeError('Ribbon sections not supported');
    resolveHostMath(core, pointer + layout.requests, pointer + layout.crowd, crowd);
    state = { pointer, length, count, layout, positionsOffset: layout.positions, uvsOffset: layout.uvs, normalsOffset: layout.normals,
      // Immutable and independent of WASM growth; shared CPU topology only.
      indices: new Uint16Array(new Uint16Array(core.memory.buffer, pointer + layout.indices, indexCount)) };
    refreshViews(state, core);
    cache.set(steps, state);
    return state;
  } catch (error) { core.free_f64(pointer, length); throw error; }
}

export function releaseRustBookmarkBuffers(core) {
  const cache = states.get(core);
  if (!cache) return;
  for (const state of cache.values()) core.free_f64(state.pointer, state.length);
  states.delete(core);
}

export function rustBookmarkBuffers(core, width, height, thickness, progress, peek = 10,
  open = 0, withdraw = 0, segments = 32, seed = 0, legacy = false) {
  if (!core?.bookmark_plan_a || !core.bookmark_topology || !core.memory || !core.alloc_f64 || !core.free_f64) return null;
  // Production has 8/32 segments; the scratch cache is bounded by the core's 256 sections.
  if (!Number.isFinite(width) || !Number.isFinite(height) || !Number.isFinite(thickness)
    || !Number.isFinite(progress) || !Number.isFinite(peek) || !Number.isFinite(open)
    || !Number.isFinite(withdraw) || !Number.isFinite(seed)
    || width <= 0 || height <= 0 || thickness <= 0) return null;
  const steps = core.bookmark_steps(Number(segments));
  if (!steps) return null;
  const state = obtainState(core, steps), { layout, pointer } = state;
  new Float64Array(core.memory.buffer, pointer + layout.params, 9)
    .set([width, height, thickness, progress, peek, open, withdraw, Number(segments), seed]);
  const params = pointer + layout.params, crowd = pointer + layout.crowd;
  const asked = (legacy ? core.bookmark_plan_a : core.bookmark_plan_a_refined)(params, crowd, pointer + layout.requests);
  resolveHostMath(core, pointer + layout.requests, pointer + layout.results, asked);
  const twisted = (legacy ? core.bookmark_plan_b : core.bookmark_plan_b_refined)(params, crowd, pointer + layout.results, pointer + layout.coefficients, pointer + layout.twistRequests);
  resolveHostMath(core, pointer + layout.twistRequests, pointer + layout.twistResults, twisted);
  (legacy ? core.bookmark_finish : core.bookmark_finish_refined)(params, pointer + layout.twistResults, pointer + layout.coefficients, pointer + layout.distances,
    pointer + layout.positions, pointer + layout.uvs, pointer + layout.normals, pointer + layout.indices);
  return state;
}
