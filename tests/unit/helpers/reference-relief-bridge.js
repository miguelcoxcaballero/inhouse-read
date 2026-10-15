// Frozen bridges of the kernel-level passes the production code stopped calling when the analysis and the pigment
// maps became jobs inside the core (rust-core/src/cover_relief.rs): the chamfer distance, the box blur and the
// single pigment pass, driven from JavaScript exactly as before. The frozen originals and the kernel tests use them.
// Rust kernels share one aligned allocation per generator. Array inputs are
// copied once; views are recreated after every yield because another WASM task
// may grow memory. The finally blocks release cancelled and completed work.
const LIMIT = 1_048_576;
const validShape = (width, height) => Number.isInteger(width) && Number.isInteger(height)
  && width > 0 && height > 0 && width * height <= LIMIT;
const bytes = (data, length) => (data instanceof Uint8Array || data instanceof Uint8ClampedArray) && data.length === length;

function arena(core, specifications) {
  let byteLength = 0;
  const blocks = specifications.map(specification => {
    const [Type, length, data] = specification;
    const block = { Type, length, data, offset:byteLength };
    byteLength += Math.ceil(Type.BYTES_PER_ELEMENT * length / 8) * 8;
    return block;
  });
  const count = Math.max(1, byteLength / 8), pointer = core.alloc_f64(count);
  if (!pointer) throw new Error('No se pudo reservar memoria para el relieve');
  const view = index => new blocks[index].Type(core.memory.buffer, pointer + blocks[index].offset, blocks[index].length);
  try { for (let index = 0; index < blocks.length; index++) if (blocks[index].data) view(index).set(blocks[index].data); }
  catch (error) { core.free_f64(pointer, count); throw error; }
  return { at:index => pointer + blocks[index].offset, view, free:() => core.free_f64(pointer, count) };
}

const checked = result => { if (result !== 1) throw new Error('El núcleo de relieve rechazó los datos'); };

export function canUseReliefWasm(core, width, height) {
  return Boolean(core?.memory && typeof core.relief_distance_rows === 'function' && validShape(width, height));
}

export function* wasmInsideDistance(core, mask, width, height) {
  if (!canUseReliefWasm(core, width, height) || !bytes(mask, width * height)) return null;
  const count = width * height;
  const heap = arena(core, [[Uint8Array, count, mask], [Float32Array, count]]);
  try {
    for (let from = 0; from < count; from += 8192) {
      checked(core.relief_distance_init(heap.at(0), heap.at(1), count, from, Math.min(count, from + 8192)));
      if (from + 8192 < count) yield;
    }
    for (let from = 0; from < height; from += 16) {
      checked(core.relief_distance_rows(heap.at(1), width, height, from, Math.min(height, from + 16), 0));
      if (from + 16 <= height) yield;
    }
    for (let end = height; end > 0;) {
      // Keep reverse-pass safe points at exactly the original y & 15 rows.
      const from = Math.max(0, Math.floor((end - 16) / 16) * 16 + 15);
      checked(core.relief_distance_rows(heap.at(1), width, height, from, end, 1));
      if ((from & 15) === 15) yield;
      end = from;
    }
    return heap.view(1).slice();
  } finally { heap.free(); }
}

export function* wasmBoxBlur(core, field, width, height, radius) {
  if (!canUseReliefWasm(core, width, height) || !(field instanceof Float32Array) || field.length !== width * height
    || !Number.isInteger(radius) || radius < 1 || radius > 1024) return null;
  const count = width * height, heap = arena(core, [[Float32Array, count, field], [Float32Array, count], [Float32Array, count]]);
  try {
    for (let from = 0; from < height; from += 16) {
      checked(core.relief_blur_pass(heap.at(0), heap.at(1), width, height, radius, from, Math.min(height, from + 16), 0));
      if (from + 16 <= height) yield;
    }
    for (let from = 0; from < width; from += 32) {
      checked(core.relief_blur_pass(heap.at(1), heap.at(2), width, height, radius, from, Math.min(width, from + 32), 1));
      if (from + 32 <= width) yield;
    }
    return heap.view(2).slice();
  } finally { heap.free(); }
}

/** Keep membership, distance and bevel work in one arena for each pigment. */
export function* wasmPigmentMaps(core, membership, width, height, previous = null) {
  const count = width * height, owner = previous?.owner || 0;
  if (typeof core?.relief_membership_pixels !== 'function' || typeof core?.relief_pigment_pixels !== 'function'
    || !canUseReliefWasm(core, width, height) || !(membership instanceof Float32Array) || membership.length !== count
    || membership.buffer === core.memory.buffer
    || !Number.isInteger(owner) || owner < 0 || owner > 10
    || (previous && (!owner || !bytes(previous.owners, count) || !bytes(previous.baseMask, count)
      || !(previous.baseHeight instanceof Float32Array) || previous.baseHeight.length !== count
      || !Number.isFinite(previous.heightMM) || previous.heightMM < 0))) return null;
  const bevel = Math.max(1.2, Math.max(width, height) * .003);
  const heap = arena(core, [[Float32Array, count, membership], [Uint8Array, count], [Float32Array, count],
    [Uint8Array, owner ? count : 0, previous?.owners], [Uint8Array, count, previous?.baseMask],
    [Float32Array, owner ? count : 0, previous?.baseHeight], [Uint8Array, owner ? 0 : count]]);
  try {
    for (let from = 0; from < count; from += 4096) {
      checked(core.relief_membership_pixels(heap.at(0), heap.at(1), count, from, Math.min(count, from + 4096)));
      if (from + 4096 <= count) yield;
    }
    for (let from = 0; from < count; from += 8192) {
      checked(core.relief_distance_init(heap.at(1), heap.at(2), count, from, Math.min(count, from + 8192)));
      if (from + 8192 < count) yield;
    }
    for (let from = 0; from < height; from += 16) {
      checked(core.relief_distance_rows(heap.at(2), width, height, from, Math.min(height, from + 16), 0));
      if (from + 16 <= height) yield;
    }
    for (let end = height; end > 0;) {
      const from = Math.max(0, Math.floor((end - 16) / 16) * 16 + 15);
      checked(core.relief_distance_rows(heap.at(2), width, height, from, end, 1));
      if ((from & 15) === 15) yield;
      end = from;
    }
    for (let from = 0; from < count; from += 1024) {
      checked(core.relief_pigment_pixels(heap.at(0), heap.at(2), heap.at(3), heap.at(4), heap.at(5), heap.at(6),
        count, from, Math.min(count, from + 1024), bevel, previous?.heightMM || 0, owner));
      if (from + 1024 <= count) yield;
    }
    if (owner) return { owners: heap.view(3).slice(), baseMask: heap.view(4).slice(), baseHeight: heap.view(5).slice() };
    const mask = heap.view(4).slice();
    return { mask, gloss: mask.slice(), heightMap: heap.view(6).slice() };
  } finally { heap.free(); }
}
