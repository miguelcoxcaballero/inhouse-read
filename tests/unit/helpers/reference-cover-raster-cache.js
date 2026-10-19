// A decoded cover stays alive while its shelf and lifted copies overlap.
// Keep one detailed print per lease, at most 8 MiB of RGBA pixels in total.
// Finish/relief changes use separate maps; they never mutate these pixels.
const MAX_PIXELS = 2 * 1024 * 1024;
const rasters = new Map();
let retainedPixels = 0;

export function reuseCoverRaster(owner, key, build) {
  if (!owner) return build();
  let cached = rasters.get(owner);
  if (!cached || cached.key !== key) {
    const result = build();
    const { width, height } = result.map.image;
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || width * height > MAX_PIXELS) {
      releaseCoverRaster(owner);
      return result;
    }
    releaseCoverRaster(owner);
    const pixels = width * height;
    // Drop only the cache's least recently used base. A displayed model still
    // owns its texture clone and exact pixels; eviction never repaints it.
    while (retainedPixels + pixels > MAX_PIXELS) releaseCoverRaster(rasters.keys().next().value);
    cached = { ...result, key, pixels };
    retainedPixels += pixels;
    rasters.set(owner, cached);
  } else {
    rasters.delete(owner);
    rasters.set(owner, cached);
  }
  // Texture.copy flags the shared Source dirty. Restore that version so the
  // same context can reuse its upload. The clone still has its own lifecycle.
  const version = cached.map.source.version, map = cached.map.clone();
  map.source.version = version;
  return { map, bounds:cached.bounds };
}

export function releaseCoverRaster(owner) {
  const cached = rasters.get(owner);
  if (!cached) return;
  rasters.delete(owner);
  retainedPixels -= cached.pixels;
  cached.map.dispose();
}
