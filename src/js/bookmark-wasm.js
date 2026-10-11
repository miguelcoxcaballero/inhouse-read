// Exact JS transcendental coefficients feed one Rust mesh operation. A small
// arena per production segment count is reused, with no per-frame arrays or
// Vector3 objects. These scratch views must be copied before the next call.
const states = new WeakMap();
const align8 = size => Math.ceil(size / 8) * 8;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const lerp = (from, to, amount) => (1 - amount) * from + amount * to;
const smoothstep = (value, low, high) => {
  if (value <= low) return 0;
  if (value >= high) return 1;
  value = (value - low) / (high - low);
  return value * value * (3 - 2 * value);
};
// Same integer lattice used by the existing book cloth and ribbon variation.
const lattice = (i, j, salt) => {
  let h = Math.imul(i * 374761393 + j * 668265263 + salt * 1442695041 | 0, 1274126177);
  h = Math.imul(h ^ h >>> 13, 1103515245);
  return ((h ^ h >>> 16) >>> 0) / 4294967296;
};

function refreshViews(state, core) {
  if (state.buffer === core.memory.buffer) return;
  state.buffer = core.memory.buffer;
  state.coefficients = new Float64Array(state.buffer, state.pointer, state.count * 7);
  state.positions = new Float32Array(state.buffer, state.pointer + state.positionsOffset, state.count * 12);
  state.uvs = new Float32Array(state.buffer, state.pointer + state.uvsOffset, state.count * 8);
  state.normals = new Float32Array(state.buffer, state.pointer + state.normalsOffset, state.count * 12);
}

function obtainState(core, steps) {
  let cache = states.get(core);
  if (!cache) states.set(core, cache = new Map());
  let state = cache.get(steps);
  if (state) { refreshViews(state, core); return state; }
  const count = steps + 1, indexCount = steps * 24 + 12;
  const distanceOffset = count * 7 * 8;
  const positionsOffset = distanceOffset + count * 8;
  const uvsOffset = positionsOffset + align8(count * 12 * 4);
  const normalsOffset = uvsOffset + align8(count * 8 * 4);
  const indicesOffset = normalsOffset + align8(count * 12 * 4);
  const length = Math.ceil((indicesOffset + indexCount * 2) / 8);
  const pointer = core.alloc_f64(length);
  if (!pointer || pointer + length * 8 > core.memory.buffer.byteLength) throw new Error('Ribbon allocation failed');
  try {
    core.bookmark_topology(pointer + indicesOffset, steps);
    state = { pointer, length, count, distanceOffset, positionsOffset, uvsOffset, normalsOffset, indicesOffset,
      // Immutable and independent of WASM growth; shared CPU topology only.
      indices:new Uint16Array(new Uint16Array(core.memory.buffer, pointer + indicesOffset, indexCount)) };
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
  open = 0, withdraw = 0, segments = 32, seed = 0) {
  if (!core?.bookmark_mesh || !core.bookmark_topology || !core.memory || !core.alloc_f64 || !core.free_f64) return null;
  const steps = Math.max(4, Math.round((Number(segments) || 32) / 2) * 2);
  // Production has 8/32 segments. Bound the optional scratch cache; unusual
  // imported/custom inputs keep the original, unrestricted geometry builder.
  if (!Number.isFinite(width) || !Number.isFinite(height) || !Number.isFinite(thickness)
    || !Number.isFinite(progress) || !Number.isFinite(peek) || !Number.isFinite(open)
    || !Number.isFinite(withdraw) || !Number.isFinite(seed)
    || width <= 0 || height <= 0 || thickness <= 0 || steps > 256) return null;
  const state = obtainState(core, steps), data = state.coefficients;
  const ribbonWidth = Math.min(width * .09, Math.max(height * .035, Math.min(height * .055, thickness * .42)));
  const vary1 = seed ? lattice(seed % 65521, 1, 17) : .5;
  const vary2 = seed ? lattice(seed % 65521, 2, 17) : .5;
  const vary3 = seed ? lattice(seed % 65521, 3, 17) : .5;
  const vary4 = seed ? lattice(seed % 65521, 4, 17) : .5;
  const vary5 = seed ? lattice(seed % 65521, 5, 17) : .5;
  const vary6 = seed ? lattice(seed % 65521, 6, 17) : .5;
  const vary7 = seed ? lattice(seed % 65521, 7, 17) : .5;
  const visibleLength = height * Math.max(.09, Math.min(.17, (Number(peek) || 10) / 200 * 1.6)) * (1 + (seed ? .12 * vary1 : 0));
  const opening = Math.max(0, Math.min(1, open));
  const leaves = Math.max(0, thickness / 2 - height * .0125);
  const insideDepth = clamp(thickness / 2 - thickness * Math.max(0, Math.min(1, progress)), -leaves, leaves);
  const pageDepth = thickness / 2 - height * .0083 + height * .002;
  const depth = lerp(insideDepth, pageDepth, smoothstep(opening, 0, .3));
  const lay = smoothstep(opening, .05, .55), flop = smoothstep(opening, .15, .85);
  const x = lerp(-width / 2 + Math.max(thickness * .75, ribbonWidth * 1.5), -width / 2 + height * .012 + ribbonWidth * .5 + width * .006, lay);
  const lift = height * 1.25 * Math.max(0, Math.min(1, withdraw));
  const pageTop = height / 2 - height * .009, bend = height * .016;
  const head = lerp(height / 2 - height * .012, pageTop - bend * .3, lay);
  const tail = lerp(height / 2 - height * .64, -height / 2 + height * .03, lay);
  const upper = visibleLength + height * .012;
  const back = visibleLength * (.1 + .16 * vary2), drift = visibleLength * (vary3 - .5) * .36;
  const arc = bend * Math.PI / 2, reachBack = pageDepth - bend - (-thickness / 2 + height * .0084);
  const fabricDepth = height * .0018;
  const twistMax = Math.PI / 2 * (.74 + .08 * vary4);
  const reach = Math.sin(twistMax) * ribbonWidth / 2;
  const inward = (clamp(depth, -leaves + reach, leaves - reach) - depth) * (1 - lay);
  const bodyLength = head - tail, wander = ribbonWidth * (.12 + .1 * vary6), splay = ribbonWidth * .3 * vary7;
  const start = lift - bodyLength, cut = upper + lift, split = Math.min(cut, Math.max(start, 0));
  const half = steps / 2, fold = Math.max(1, Math.round(steps * .19)), folded = Math.min(cut, split + arc * 1.1);
  for (let i = 0; i <= steps; i++) {
    const s = i <= half ? lerp(start, split, i / half)
      : i - half <= fold ? split + (folded - split) * ((i - half) / fold) ** 1.4
      : lerp(folded, cut, (i - half - fold) / (half - fold));
    let px = x, py = head, pz = depth;
    const turned = twistMax * smoothstep(s, -height * .006, height * .0025);
    const tuck = inward * Math.sin(turned) / (Math.sin(twistMax) || 1);
    let twist = turned * (1 - lay);
    if (s <= 0) {
      const u = -s / bodyLength;
      px += lay * (wander * Math.sin(Math.PI * 1.3 * u) + splay * u * u);
      py += s;
      pz += lay * height * .0012 * (1 - Math.cos(u * Math.PI * 4)) / 2;
      twist += lay * .22 * Math.sin(u * Math.PI * 2.6 + vary5 * 6) * (1 - (1 - u) ** 3);
    } else {
      const k = flop * Math.PI / 2 / arc, bent = Math.min(s, arc);
      const run = Math.min(s - bent, reachBack + (1 - flop) * height * 4);
      const angle = k * bent, fall = smoothstep(Math.min(1, s / upper), 0, 1) * (1 - flop);
      px += back * fall;
      py += (k > 1e-6 ? Math.sin(angle) / k : bent) + run * Math.cos(angle);
      pz += (k > 1e-6 ? (Math.cos(angle) - 1) / k : 0) - run * Math.sin(angle) + drift * fall;
    }
    const at = i * 7;
    data[at] = px; data[at + 1] = py; data[at + 2] = pz;
    data[at + 3] = Math.cos(twist); data[at + 4] = Math.sin(twist);
    data[at + 5] = tuck; data[at + 6] = s <= 0 ? 1 : 0;
  }
  core.bookmark_mesh(state.pointer, state.pointer + state.distanceOffset, steps, ribbonWidth, fabricDepth, lay,
    state.pointer + state.positionsOffset, state.pointer + state.uvsOffset, state.pointer + state.normalsOffset, state.pointer + state.indicesOffset);
  return state;
}
