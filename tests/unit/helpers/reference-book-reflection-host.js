// Frozen copy of src/js/book-reflection-surface.js as of ready/book-model-4 (the layer was then installed in
// JavaScript); only its import path differs. reference-book-model.js uses it, so the model differential compares
// the shelf module's installation (rust-ui/src/book_reflection.rs) with this one.
import { ShaderChunk, Vector2, Vector3 } from 'three';
import { needRustShelf } from '../../../src/js/rust-shelf.js';

// A covered board is slightly uneven beneath its laminate. Keep that shape
// entirely in the reflection layer: neither the printed image, Lambert light,
// cover silhouette nor shadow geometry should acquire visible bumps.
const CACHE_KEY = 'book-reflection-surface-v2';
const installed = new WeakMap();

// The profile (wave phases and amplitude of a book's identity) and the clamps of every setter are computed in Rust
// (rust-ui/src/book_reflection.rs, the `shelf` module the first shelf render awaits).
function reflectionProfile(seed) {
  const [x, y, z, amplitude] = needRustShelf().reflection_profile(seed);
  return { phase:new Vector3(x, y, z), amplitude };
}

// The shader text of the layer (analytic slopes of three broad height waves, specular-only, with three's
// physical chunk overriding only its specular terms) is the shelf module's (rust-ui/src/book_shaders.rs).
// Like the original, the two chunks it patches are read once, as this module loads.
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
const reflectionPatches = new Map();

/** Add stable, specular-only board waviness to one outer physical material.
 * Install after any existing onBeforeCompile hook (e.g. spine grazing fade).
 * Seed with the book's stable identity, optionally suffixed by surface name.
 * Strength is a dimensionless slope: .018 cover, .014 binding, .010 cap.
 * uvScale converts unnormalized cap UVs into one wave field per surface.
 * userData.bookReflectionSurface.setStrength(0) provides a uniform-only A/B;
 * it does not rebuild materials, programs, textures, geometry or shadows. */
export function applyBookReflectionSurface(material, { seed = '', strength = .018, uvScale = [1, 1], environmentReflection = 1 } = {}) {
  if (!material?.isMeshStandardMaterial) return material;
  const existing = installed.get(material);
  if (existing) {
    existing.setSeed(seed); existing.setStrength(strength); existing.setUvScale(uvScale); existing.setEnvironmentReflection(environmentReflection);
    return material;
  }

  let profile = reflectionProfile(seed), slope = 0;
  const uniforms = { bookReflectionPhase:{ value:profile.phase }, bookReflectionStrength:{ value:0 },
    bookReflectionUvScale:{ value:new Vector2(1, 1) }, bookEnvironmentReflection:{ value:1 } };
  const controls = {
    uniforms,
    setEnvironmentReflection(value) {
      uniforms.bookEnvironmentReflection.value = needRustShelf().reflection_environment(value);
    },
    setStrength(value) {
      slope = needRustShelf().reflection_slope(value);
      uniforms.bookReflectionStrength.value = slope * profile.amplitude;
    },
    setSeed(value) {
      profile = reflectionProfile(value);
      uniforms.bookReflectionPhase.value.copy(profile.phase);
      uniforms.bookReflectionStrength.value = slope * profile.amplitude;
    },
    setUvScale(value) {
      const [x, y] = needRustShelf().reflection_uv_scale(value);
      uniforms.bookReflectionUvScale.value.set(x, y);
    }
  };
  controls.setStrength(strength);
  controls.setEnvironmentReflection(environmentReflection);
  controls.setUvScale(uvScale);
  installed.set(material, controls);
  material.userData.bookReflectionSurface = controls;

  const beforeCompile = material.onBeforeCompile;
  // Capture the prior key before replacing onBeforeCompile: Three's default
  // cache key is the hook's source. Book phases/strength are only uniforms,
  // so hundreds of books still share a shader program for a material variant.
  const previousKey = material.customProgramCacheKey();
  material.onBeforeCompile = function(shader, renderer) {
    beforeCompile.call(this, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    const { vertexShader, fragmentShader } = shader;
    const [vertex, fragment] = rememberedPatch(reflectionPatches, [vertexShader, fragmentShader],
      () => needRustShelf().book_reflection_shaders(vertexShader, fragmentShader, physicalChunk, mapsChunk));
    shader.vertexShader = vertex; shader.fragmentShader = fragment;
  };
  material.customProgramCacheKey = () => `${previousKey}|${CACHE_KEY}`;
  material.needsUpdate = true;
  return material;
}
