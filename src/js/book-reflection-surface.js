import { ShaderChunk, Vector2, Vector3 } from 'three';
import { needRustShelf } from './rust-shelf.js';

// A covered board is slightly uneven beneath its laminate. Keep that shape
// entirely in the reflection layer: neither the printed image, Lambert light,
// cover silhouette nor shadow geometry should acquire visible bumps.

// The physical chunk overriding only its specular terms, the analytic slopes of three broad height waves and the
// profile (wave phases and amplitude of a book's identity) are the shelf module's (rust-ui/src/book_shaders.rs,
// rust-ui/src/book_reflection.rs). Like the original, the two chunks it patches are read once, as this module loads.
const physicalChunk = ShaderChunk.lights_physical_pars_fragment, mapsChunk = ShaderChunk.lights_fragment_maps;

/** The patched sources of a hook, remembered per distinct sources (and chunks): a shelf of books compiles
 * each program variant with one patch instead of one per material. */
export function rememberedPatch(cache, keys, patch) {
  let level = cache;
  for (let i = 0; i < keys.length - 1; i++) {
    let next = level.get(keys[i]);
    if (!next) level.set(keys[i], next = new Map());
    level = next;
  }
  const last = keys[keys.length - 1];
  let result = level.get(last);
  if (result === undefined) {
    // Sources are three's own program text: a handful of variants. Bound the cache all the same.
    if (cache.size > 64) cache.clear();
    level.set(last, result = patch());
  }
  return result;
}

/** Add stable, specular-only board waviness to one outer physical material.
 * Install after any existing onBeforeCompile hook (e.g. spine grazing fade).
 * Seed with the book's stable identity, optionally suffixed by surface name.
 * Strength is a dimensionless slope: .018 cover, .014 binding, .010 cap.
 * uvScale converts unnormalized cap UVs into one wave field per surface.
 * userData.bookReflectionSurface.setStrength(0) provides a uniform-only A/B;
 * it does not rebuild materials, programs, textures, geometry or shadows.
 * Every number (profile, slope, environment share, UV scale) comes from one call to the shelf module
 * (rust-ui/src/book_reflection.rs, reflection_setup); the controls and the hook are its functions bound to
 * the layer's state. A shelf installs five layers per book: only the three objects are made here. */
export function applyBookReflectionSurface(material, { seed = '', strength = .018, uvScale = [1, 1], environmentReflection = 1 } = {}) {
  if (!material?.isMeshStandardMaterial) return material;
  const host = reflectionHost(), existing = host.installed.get(material);
  if (existing) {
    existing.setSeed(seed); existing.setStrength(strength); existing.setUvScale(uvScale); existing.setEnvironmentReflection(environmentReflection);
    return material;
  }
  const rust = host.rust, n = host.numbers;
  rust.reflection_setup(n, seed, strength, environmentReflection, uvScale?.[0] ?? uvScale?.x, uvScale?.[1] ?? uvScale?.y);
  const uniforms = { bookReflectionPhase:{ value:new Vector3(n[0], n[1], n[2]) }, bookReflectionStrength:{ value:n[4] * n[3] },
    bookReflectionUvScale:{ value:new Vector2(n[6], n[7]) }, bookEnvironmentReflection:{ value:n[5] } };
  const r = { uniforms, amplitude:n[3], slope:n[4], three:host.three };
  const controls = { uniforms, setEnvironmentReflection:rust.book_reflection_set_environment.bind(null, r),
    setStrength:rust.book_reflection_set_strength.bind(null, r), setSeed:rust.book_reflection_set_seed.bind(null, r),
    setUvScale:rust.book_reflection_set_uv_scale.bind(null, r) };
  host.installed.set(material, controls);
  material.userData.bookReflectionSurface = controls;
  // Capture the prior key before replacing onBeforeCompile: Three's default
  // cache key is the hook's source. Book phases/strength are only uniforms,
  // so hundreds of books still share a shader program for a material variant.
  const before = material.onBeforeCompile, key = `${material.customProgramCacheKey()}|book-reflection-surface-v2`;
  material.onBeforeCompile = rust.book_reflection_compile.bind(null, host, r, material, before);
  material.customProgramCacheKey = () => key;
  material.needsUpdate = true;
  return material;
}
let reflectionHostObject;
const reflectionHost = () => reflectionHostObject ||= { rust:needRustShelf(), three:{ Vector2, Vector3 }, installed:new WeakMap(),
  patches:new Map(), rememberedPatch, physicalChunk, mapsChunk, numbers:new Float64Array(8) };
