// The host preserves browser pow/hypot coefficients; Rust builds the exact
// page meshes. Every result owns its arrays and every scratch arena is freed.
const align8 = bytes => Math.ceil(bytes / 8) * 8;
const available = (core, kernel) => typeof core?.[kernel] === 'function'
  && core.memory && typeof core.alloc_f64 === 'function' && typeof core.free_f64 === 'function';
const positive = value => Number.isFinite(value) && value > 0;
const nonnegative = value => Number.isFinite(value) && value >= 0;

function withMesh(core, vertices, indexCount, coefficientCount, fill, groups) {
  const positionOffset = coefficientCount * 8;
  const normalOffset = positionOffset + align8(vertices * 3 * 4);
  const uvOffset = normalOffset + align8(vertices * 3 * 4);
  const colorOffset = uvOffset + align8(vertices * 2 * 4);
  const indexOffset = colorOffset + align8(vertices * 3 * 4);
  const length = Math.ceil((indexOffset + indexCount * 2) / 8);
  let pointer;
  try { pointer = core.alloc_f64(length); } catch { return null; }
  if (!pointer) return null;
  try {
    fill(pointer, new Float64Array(core.memory.buffer, pointer, coefficientCount),
      pointer + positionOffset, pointer + normalOffset, pointer + uvOffset, pointer + colorOffset, pointer + indexOffset);
    const buffer = core.memory.buffer;
    return {
      positions:new Float32Array(new Float32Array(buffer, pointer + positionOffset, vertices * 3)),
      normals:new Float32Array(new Float32Array(buffer, pointer + normalOffset, vertices * 3)),
      uvs:new Float32Array(new Float32Array(buffer, pointer + uvOffset, vertices * 2)),
      colors:new Float32Array(new Float32Array(buffer, pointer + colorOffset, vertices * 3)),
      indices:new Uint16Array(new Uint16Array(buffer, pointer + indexOffset, indexCount)), groups,
    };
  } catch { return null; } // Pure numeric operation; the original mesh remains available.
  finally { core.free_f64(pointer, length); }
}

export function rustPageBlockBuffers(core, width, height, thickness,
  { board = height * .007, inset = height * .009, detail = false } = {}) {
  if (!available(core, 'page_block_mesh') || ![width, height, thickness].every(positive)
    || ![board, inset].every(nonnegative)) return null;
  const half = (thickness - board * 2.4) / 2, top = height / 2 - inset;
  const zBack = thickness / 2 - board * 1.1;
  if (![half, top, zBack, height * .2, half ** 2].every(positive)) return null;
  const columns = detail ? 16 : 8, rows = detail ? 6 : 3;
  const vertices = 2 * (columns + 1) * (rows + 1) + 2 * (columns + 1) + 8;
  const indexCount = columns * rows * 12 + columns * 6 + 12;
  const rowOffset = (columns + 1) * 3;
  return withMesh(core, vertices, indexCount, rowOffset + rows + 1, (pointer, coefficients, ...outputs) => {
    const bend = Math.min(thickness * .09, width * .025);
    for (let i = 0; i <= columns; i++) {
      const z = -half + i / columns * half * 2;
      const slope = 2 * bend * z / half ** 2, length = Math.hypot(1, slope), at = i * 3;
      coefficients[at] = 1 - .18 * Math.abs(z / half) ** 6;
      coefficients[at + 1] = 1 / length; coefficients[at + 2] = -slope / length;
    }
    for (let row = 0; row <= rows; row++) coefficients[rowOffset + row] = (row / rows) ** 1.7;
    core.page_block_mesh(pointer, pointer + rowOffset * 8, width, height, thickness, board, inset, columns, rows, ...outputs);
  }, [{ start:0, count:indexCount, materialIndex:0 }]);
}

export function rustLeafStackBuffers(core, width, height, depth,
  { board = height * .007, inset = height * .009, columns = 14 } = {}) {
  if (!available(core, 'leaf_stack_mesh') || ![width, height].every(positive)
    || ![depth, board, inset].every(nonnegative) || !Number.isInteger(columns) || columns < 1 || columns > 512) return null;
  const top = height / 2 - inset - height * .0012, fore = width - inset * .7 - height * .0015;
  const gutter = Math.min(fore * .2, height * .075);
  if (![top, fore, gutter, height * .2].every(positive)) return null;
  const vertices = 6 * (columns + 1) + 4, indexCount = columns * 18 + 6, faceCount = columns * 6;
  return withMesh(core, vertices, indexCount, (columns + 1) * 3, (pointer, coefficients, ...outputs) => {
    for (let i = 0; i <= columns; i++) {
      const x = fore * (i / columns) ** 1.7;
      const slope = -depth * (x < gutter ? (1 - .16) * (2 - 2 * x / gutter) / gutter : 0);
      const length = Math.hypot(slope, 1), at = i * 3;
      coefficients[at] = x; coefficients[at + 1] = slope / length; coefficients[at + 2] = -1 / length;
    }
    core.leaf_stack_mesh(pointer, width, height, depth, board, inset, columns, ...outputs);
  }, [{ start:0, count:faceCount, materialIndex:0 }, { start:faceCount, count:indexCount - faceCount, materialIndex:1 }]);
}
