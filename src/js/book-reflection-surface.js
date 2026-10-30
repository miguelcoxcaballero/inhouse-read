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
 * The controls and the hook are the shelf module's functions bound to the layer's state (book_reflection.rs). */
export function applyBookReflectionSurface(material, options) {
  return needRustShelf().book_reflection_apply(reflectionHost(), material, options);
}
let reflectionHostObject;
const reflectionHost = () => reflectionHostObject ||= { rust:needRustShelf(), three:{ Vector2, Vector3 }, installed:new WeakMap(),
  patches:new Map(), rememberedPatch, physicalChunk, mapsChunk, constant:value => value };
