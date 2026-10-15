import { needRustShelf } from './rust-shelf.js';

// Rust kernels share one aligned allocation per generator. Array inputs are
// copied once; views are recreated after every yield because another WASM task
// may grow memory. The finally blocks release cancelled and completed work.
// The analysis and the pigment maps are jobs inside the core (rust-core/src/cover_relief.rs): the pixels
// are copied in once, the job owns everything it needs until it is freed and the host only steps it.
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

export function* wasmHeightToNormals(core, maps, unit, { selectionAlpha = false } = {}) {
  const { width, height, heightMap, owners, mask } = maps, count = width * height;
  if (!canUseReliefWasm(core, width, height) || !bytes(heightMap, count)
    || (owners && !bytes(owners, count)) || (maps.preserveInk && !bytes(mask, count)) || !Number.isFinite(unit)) return null;
  if (selectionAlpha && (typeof core.relief_normal_selected_rows !== 'function'
    || (mask ? !bytes(mask, count) : !bytes(maps.foil, count) || !bytes(maps.gloss, count)))) return null;
  const useMask = maps.preserveInk || (selectionAlpha && mask);
  const extraPlanes = selectionAlpha && !mask;
  const heap = arena(core, [[Uint8Array, count, heightMap], [Uint8Array, owners ? count : 0, owners],
    [Uint8Array, useMask ? count : 0, useMask ? mask : null], [Uint8ClampedArray, count * 4],
    [Uint8Array, extraPlanes ? count : 0, extraPlanes ? maps.foil : null],
    [Uint8Array, extraPlanes ? count : 0, extraPlanes ? maps.gloss : null]]);
  try {
    for (let from = 0; from < height; from += 16) {
      const kernel = selectionAlpha ? core.relief_normal_selected_rows : core.relief_normal_rows;
      checked(kernel(heap.at(0), heap.at(1), heap.at(2), heap.at(3), width, height,
        from, Math.min(height, from + 16), owners ? 1 : 0, maps.preserveInk ? 1 : 0, unit,
        mask ? 1 : 0, heap.at(4), heap.at(5)));
      if (from + 16 <= height) yield;
    }
    return heap.view(3).slice();
  } finally { heap.free(); }
}

export function* wasmComposeMaterialMap(core, maps, { base, foilRoughness, glossRoughness, glossCoatRoughness, profiles }) {
  const { width, height, foil, gloss, owners } = maps, count = width * height;
  if (!canUseReliefWasm(core, width, height) || !bytes(foil, count) || !bytes(gloss, count)
    || (profiles?.length && !bytes(owners, count)) || (profiles?.length || 0) > 10
    || ![base, foilRoughness, glossRoughness, glossCoatRoughness].every(Number.isFinite)) return null;
  const coefficients = Float64Array.from((profiles || []).flatMap(profile => [profile.roughness, profile.clearcoatRoughness]));
  if (!coefficients.every(Number.isFinite)) return null;
  const heap = arena(core, [[Uint8Array, count, foil], [Uint8Array, count, gloss],
    [Uint8Array, coefficients.length ? count : 0, coefficients.length ? owners : null],
    [Float64Array, coefficients.length, coefficients], [Uint8ClampedArray, count * 4]]);
  try {
    for (let from = 0; from < count; from += 4096) {
      checked(core.relief_material_pixels(heap.at(0), heap.at(1), heap.at(2), heap.at(3), heap.at(4), count,
        from, Math.min(count, from + 4096), coefficients.length / 2, maps.preserveInk ? 1 : 0,
        base, foilRoughness, glossRoughness, glossCoatRoughness));
      if (from + 4096 <= count) yield;
    }
    return heap.view(4).slice();
  } finally { heap.free(); }
}

export function* wasmComposeReliefLayers(core, maps, layers) {
  const { width, height, owners, baseMask, baseHeight } = maps, count = width * height;
  if (!canUseReliefWasm(core, width, height) || !bytes(owners, count) || !bytes(baseMask, count)
    || !(baseHeight instanceof Float32Array) || baseHeight.length !== count || layers.length > 10) return null;
  const strengths = Float64Array.from(layers, layer => layer.strength);
  if (!strengths.every(Number.isFinite)) return null;
  const heap = arena(core, [[Uint8Array, count, owners], [Uint8Array, count, baseMask],
    [Float32Array, count, baseHeight], [Float64Array, strengths.length, strengths], [Uint8Array, count * 3]]);
  try {
    for (let from = 0; from < count; from += 1024) {
      checked(core.relief_compose_pixels(heap.at(0), heap.at(1), heap.at(2), heap.at(3), heap.at(4), count,
        from, Math.min(count, from + 1024), strengths.length));
      if (from + 1024 <= count) yield;
    }
    const output = heap.view(4);
    return { ...maps, layers, mask:output.slice(0, count), gloss:output.slice(count, count * 2),
      heightMap:output.slice(count * 2), foil:new Uint8Array(count) };
  } finally { heap.free(); }
}

export function* wasmShadePreview(core,image,maps,k){
 const {width,height,data}=image,count=width*height,mapCount=maps.width*maps.height;
 if(typeof core?.relief_preview_rows!=='function'||!validShape(width,height)||!validShape(maps.width,maps.height)||!bytes(data,count*4)
  ||!bytes(maps.heightMap,mapCount)||!bytes(maps.foil,mapCount)||!bytes(maps.gloss,mapCount)||(maps.preserveInk&&!bytes(maps.mask,mapCount))||!Number.isFinite(k)||Math.abs(k)>1e6)return null;
 const light=[-.52,.58,.63],lightLength=Math.hypot(...light);for(let i=0;i<3;i++)light[i]/=lightLength;
 const half=[light[0],light[1],light[2]+1],halfLength=Math.hypot(...half);for(let i=0;i<3;i++)half[i]/=halfLength;
 const coefficients=Float64Array.from([...light,...half,k]);
 const heap=arena(core,[[Uint8Array,count*4,data],[Uint8Array,mapCount,maps.heightMap],[Uint8Array,mapCount,maps.foil],
  [Uint8Array,mapCount,maps.gloss],[Uint8Array,maps.preserveInk?mapCount:0,maps.preserveInk?maps.mask:null],[Float64Array,7,coefficients],[Uint8ClampedArray,count*4]]);
 try{
  for(let from=0;from<height;from+=8){
   checked(core.relief_preview_rows(heap.at(0),heap.at(1),heap.at(2),heap.at(3),heap.at(4),heap.at(5),heap.at(6),width,height,maps.width,maps.height,from,Math.min(height,from+8),maps.preserveInk?1:0));
   if(from+8<=height)yield;
  }
  return heap.view(6).slice();
 }finally{heap.free();}
}

/** Convert all preview planes together; callers retain independent owned arrays. */
export function wasmReliefRgbaPlanes(core, maps) {
  const { width, height, heightMap, foil, gloss } = maps;
  const count = width * height;
  if (typeof core?.relief_rgba_planes !== 'function' || !validShape(width, height)
    || ![heightMap, foil, gloss].every(plane => bytes(plane, count))) return null;
  let heap;
  try {
    heap = arena(core, [[Uint8Array, count * 3], [Uint8ClampedArray, count * 12]]);
    // Pack all three planes contiguously, including odd pixel counts.
    const input = new Uint8Array(core.memory.buffer, heap.at(0), count * 3);
    input.set(heightMap); input.set(foil, count); input.set(gloss, count * 2);
    checked(core.relief_rgba_planes(heap.at(0), heap.at(1), count));
    const output = heap.view(1);
    return { height: output.slice(0, count * 4), foil: output.slice(count * 4, count * 8),
      gloss: output.slice(count * 8) };
  } catch { return null; }
  finally { heap?.free(); }
}


// ---- jobs: palette analysis and pigment maps ------------------------------------------------------
const JOB_LIMIT = 512 * 512;
const rgbOf = hex => [1, 3, 5].map(at => parseInt(hex.slice(at, at + 2), 16));
// The sRGB curve is the host's own (the engine's `**` rounds differently from the core's): the shelf module
// computes the 256 values and each core instance takes them once, before its first job.
const tabled = new WeakSet();
function withLinearTable(core) {
  if (tabled.has(core.memory)) return true;
  const pointer = core.alloc_f64(256);
  if (!pointer) return false;
  try {
    new Float64Array(core.memory.buffer, pointer, 256).set(needRustShelf().relief_linear_table());
    if (core.relief_linear_set(pointer) !== 1) return false;
  } finally { core.free_f64(pointer, 256); }
  tabled.add(core.memory);
  return true;
}
const jobShape = (core, image, names) => {
  const { width, height, data } = image || {};
  return Boolean(core?.memory && typeof core.alloc_f64 === 'function' && typeof core.free_f64 === 'function'
    && typeof core.relief_job_step === 'function' && typeof core.relief_job_free === 'function'
    && typeof core.relief_linear_set === 'function' && names.every(name => typeof core[name] === 'function')
    && Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0 && width * height <= JOB_LIMIT
    && bytes(data, width * height * 4)
    // The pixels are copied into a fresh arena; a view into the core's own memory could be detached by it.
    && data.buffer !== core.memory.buffer && withLinearTable(core));
};

/** A job over the pixels of `image` (and `extra` f64 values after them): the arena exists only while the
 * job copies its input. Returns 0 when the core rejects the data. */
function openJob(core, image, extra, make) {
  const { data } = image, offset = Math.ceil(data.length / 8) * 8, words = offset / 8 + extra.length;
  const pointer = core.alloc_f64(Math.max(1, words));
  if (!pointer) throw new Error('No se pudo reservar memoria para el relieve');
  try {
    new Uint8Array(core.memory.buffer, pointer, data.length).set(data);
    new Float64Array(core.memory.buffer, pointer + offset, extra.length).set(extra);
    return make(pointer, pointer + offset);
  } finally { core.free_f64(pointer, Math.max(1, words)); }
}

/** Step a job to its end: 1 gives the main thread back, 2 carries on, negative is a failed pass. */
function* stepJob(core, job) {
  for (;;) {
    const code = core.relief_job_step(job);
    if (code === 0) return;
    if (code < 0) throw new Error('El núcleo de relieve rechazó los datos');
    if (code === 1) yield;
  }
}

/** Colour analysis of a cover raster: seed, opaque pixels and up to ten colours, each with its tolerance, the
 * pixels its ball covers and its f32 membership plane. */
export function* wasmAnalyze(core, image) {
  if (!jobShape(core, image, ['relief_analysis_new', 'relief_analysis_value', 'relief_analysis_colour', 'relief_analysis_mask'])) return null;
  const { width, height } = image, count = width * height;
  const job = openJob(core, image, [], pointer => core.relief_analysis_new(pointer, width, height));
  if (!job) return null;
  try {
    yield* stepJob(core, job);
    const seed = core.relief_analysis_value(job, 0), opaque = core.relief_analysis_value(job, 1);
    const found = core.relief_analysis_value(job, 2), colours = [];
    if (!Number.isInteger(seed) || seed < 0 || !Number.isInteger(opaque) || !Number.isInteger(found) || found < 0 || found > 10) return null;
    const fields = core.alloc_f64(6);
    if (!fields) throw new Error('No se pudo reservar memoria para el relieve');
    try {
      for (let index = 0; index < found; index++) {
        checked(core.relief_analysis_colour(job, index, fields));
        const [r, g, b, tolerance, pixels] = new Float64Array(core.memory.buffer, fields, 5);
        colours.push({ rgb:[r, g, b], tolerance, pixels,
          mask:new Float32Array(core.memory.buffer, core.relief_analysis_mask(job, index), count).slice() });
      }
    } finally { core.free_f64(fields, 6); }
    return { seed, opaque, colours };
  } finally { core.relief_job_free(job); }
}

/** Exclusive pigment maps of `layers` ({ color:'#rrggbb', tolerance, heightMM }) over a raster. One standalone
 * layer (`single`) yields the byte maps; several yield owners, base mask and base height. */
export function* wasmMaps(core, image, layers, single = false) {
  if (!jobShape(core, image, ['relief_maps_new', 'relief_maps_plane']) || !Array.isArray(layers)
    || layers.length < 1 || layers.length > 10) return null;
  const { width, height } = image, count = width * height;
  const fields = layers.flatMap(layer => [...rgbOf(layer.color), layer.tolerance, layer.heightMM ?? 0]);
  const job = openJob(core, image, fields, (pixels, extra) => core.relief_maps_new(pixels, width, height, extra, layers.length, single ? 1 : 0));
  if (!job) return null;
  try {
    yield* stepJob(core, job);
    const plane = (which, Type) => new Type(core.memory.buffer, core.relief_maps_plane(job, which), count).slice();
    if (single) {
      const mask = plane(1, Uint8Array);
      return { mask, gloss:mask.slice(), heightMap:plane(3, Uint8Array) };
    }
    return { owners:plane(0, Uint8Array), baseMask:plane(1, Uint8Array), baseHeight:plane(2, Float32Array) };
  } finally { core.relief_job_free(job); }
}
