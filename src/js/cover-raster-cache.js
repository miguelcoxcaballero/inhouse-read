// A decoded cover stays alive while its shelf and lifted copies overlap.
// Keep just one detailed print (at most 8 MiB of RGBA pixels) in that lease.
// Finish/relief changes use separate maps; they never mutate these pixels.
const MAX_PIXELS = 2 * 1024 * 1024;
const rasters = new WeakMap();

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
    cached = { ...result, key };
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
  cached.map.dispose();
}
