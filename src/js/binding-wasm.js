// Host adapter for the curved binding. Owned output arrays survive WASM
// growth, recursive relief sampling and disposal of every scratch allocation.
const align8 = bytes => Math.ceil(bytes / 8) * 8;

export function rustBindingBuffers(core, width, height, thickness, segments = 96, relief = null, reliefRows = 384) {
  if (!core?.binding_mesh || !core.memory || !core.alloc_f64 || !core.free_f64) return null;
  const rows = relief ? reliefRows : 1, vertices = (segments + 1) * (rows + 1);
  if (![width, height, thickness].every(value => Number.isFinite(value) && value > 0)
    || !Number.isInteger(segments) || segments < 1 || segments > 512
    || !Number.isInteger(rows) || rows < 1 || rows > 1024
    || vertices > 200_000 || relief && typeof relief !== 'function') return null;
  const coefficientBytes = (segments + 1) * 5 * 8;
  const reliefOffset = coefficientBytes;
  const positionOffset = reliefOffset + (relief ? vertices * 8 : 0);
  const normalOffset = positionOffset + align8(vertices * 3 * 4);
  const uvOffset = normalOffset + align8(vertices * 3 * 4);
  const indexOffset = uvOffset + align8(vertices * 2 * 4);
  const indexCount = segments * rows * 6;
  const length = Math.ceil((indexOffset + indexCount * 4) / 8);
  let pointer;
  try { pointer = core.alloc_f64(length); }
  catch { return null; } // Allocation failed before any relief callback ran.
  if (!pointer) return null;
  try {
    let buffer = core.memory.buffer;
    let coefficients = new Float64Array(buffer, pointer, (segments + 1) * 5);
    let samples = relief ? new Float64Array(buffer, pointer + reliefOffset, vertices) : null;
    const bulge = thickness * .38;
    for (let i = 0; i <= segments; i++) {
      const u = i / segments, angle = u * Math.PI;
      const sine = Math.sin(angle), cosine = Math.cos(angle);
      const nx = -sine / bulge, nz = -cosine / (thickness / 2), magnitude = Math.hypot(nx, nz);
      const at = i * 5;
      coefficients[at] = u; coefficients[at + 1] = sine; coefficients[at + 2] = cosine;
      coefficients[at + 3] = nx / magnitude; coefficients[at + 4] = nz / magnitude;
      if (samples) for (let j = 0; j <= rows; j++) {
        // Preserve the callback's order and exact coordinates. It may call
        // another kernel which grows memory; refresh before writing its value.
        const value = relief(u, j / rows);
        if (buffer !== core.memory.buffer) {
          buffer = core.memory.buffer;
          coefficients = new Float64Array(buffer, pointer, (segments + 1) * 5);
          samples = new Float64Array(buffer, pointer + reliefOffset, vertices);
        }
        samples[i * (rows + 1) + j] = value;
      }
    }
    core.binding_mesh(pointer, relief ? pointer + reliefOffset : 0, width, height, thickness, segments, rows,
      pointer + positionOffset, pointer + normalOffset, pointer + uvOffset, pointer + indexOffset);
    buffer = core.memory.buffer;
    // Three reserves index 65535 for primitive restart, so 65535 must use u32.
    const indexSource = new Uint32Array(buffer, pointer + indexOffset, indexCount);
    return {
      positions:new Float32Array(new Float32Array(buffer, pointer + positionOffset, vertices * 3)),
      normals:new Float32Array(new Float32Array(buffer, pointer + normalOffset, vertices * 3)),
      uvs:new Float32Array(new Float32Array(buffer, pointer + uvOffset, vertices * 2)),
      indices:vertices - 1 >= 65535 ? new Uint32Array(indexSource) : new Uint16Array(indexSource),
      normalVersion:relief ? 1 : 0,
    };
  } finally { core.free_f64(pointer, length); }
}
