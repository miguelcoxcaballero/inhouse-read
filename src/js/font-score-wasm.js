// The worker owns one immutable image arena until its job ends. Each score
// copies only the small glyph mask; no image conversion or DOM work is added.
const align8 = bytes => Math.ceil(bytes / 8) * 8;
const dimension = value => Number.isInteger(value) && value > 0 && value <= 0x3fffffff;

function arena(core, bytes) {
  const length = Math.max(1, Math.ceil(bytes / 8));
  const pointer = core.alloc_f64(length);
  if (!Number.isInteger(pointer) || pointer <= 0 || pointer + length * 8 > core.memory.buffer.byteLength) {
    throw new Error('Font score allocation failed');
  }
  return { pointer, length };
}

export function createRustFontScorer(core, { gray, near, width, height, rows }) {
  if (!core?.memory || typeof core.font_score !== 'function' || typeof core.alloc_f64 !== 'function'
    || typeof core.free_f64 !== 'function' || !(gray instanceof Uint8Array) || !(near instanceof Float32Array)
    || !dimension(width) || !dimension(height) || !dimension(rows) || rows > height
    || gray.length !== width * height || near.length !== gray.length) throw new Error('Invalid font score image');
  const nearOffset = align8(gray.byteLength);
  const image = arena(core, nearOffset + near.byteLength);
  let disposed = false;
  try {
    new Uint8Array(core.memory.buffer, image.pointer, gray.length).set(gray);
    new Float32Array(core.memory.buffer, image.pointer + nearOffset, near.length).set(near);
  } catch (error) {
    core.free_f64(image.pointer, image.length);
    throw error;
  }
  return {
    *steps(mask, budget = 1) {
      if (disposed) throw new Error('Inactive font score job');
      if (!mask || !dimension(mask.width) || !dimension(mask.height)
        || !(mask.mask instanceof Uint8Array) || mask.mask.length !== mask.width * mask.height
        || !Number.isFinite(mask.area) || mask.area < 0
        || !['perimeter', 'foreground', 'background'].every(key => mask[key] instanceof Int32Array)) {
        throw new Error('Invalid font score mask');
      }
      const perimeterOffset = align8(mask.mask.byteLength);
      const foregroundOffset = perimeterOffset + align8(mask.perimeter.byteLength);
      const backgroundOffset = foregroundOffset + align8(mask.foreground.byteLength);
      const stateOffset = backgroundOffset + align8(mask.background.byteLength);
      const scratch = arena(core, stateOffset + 56);
      try {
        // A scratch allocation may grow memory: obtain every view afterwards.
        new Uint8Array(core.memory.buffer, scratch.pointer, mask.mask.length).set(mask.mask);
        for (const [key, offset] of [['perimeter', perimeterOffset], ['foreground', foregroundOffset], ['background', backgroundOffset]]) {
          new Int32Array(core.memory.buffer, scratch.pointer + offset, mask[key].length).set(mask[key]);
        }
        new Float64Array(core.memory.buffer, scratch.pointer + stateOffset, 7).fill(0);
        const args = [image.pointer, image.pointer + nearOffset, width, height, rows,
          scratch.pointer, mask.width, mask.height, mask.area,
          scratch.pointer + perimeterOffset, mask.perimeter.length,
          scratch.pointer + foregroundOffset, mask.foreground.length,
          scratch.pointer + backgroundOffset, mask.background.length];
        let status;
        if (budget === Infinity) return core.font_score(...args);
        do {
          if (disposed) throw new Error('Inactive font score job');
          status = core.font_score_step(...args, scratch.pointer + stateOffset, budget);
          if (status > 1) throw new Error('Invalid font score step');
          if (!status) yield;
        } while (!status);
        const score = new Float64Array(core.memory.buffer, scratch.pointer + stateOffset, 7)[6];
        if (!Number.isFinite(score)) throw new Error('Invalid font score result');
        return score;
      } finally { core.free_f64(scratch.pointer, scratch.length); }
    },
    score(mask) {
      const task = this.steps(mask, Infinity);
      let result = task.next();
      while (!result.done) result = task.next();
      return result.value;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      core.free_f64(image.pointer, image.length);
    }
  };
}
