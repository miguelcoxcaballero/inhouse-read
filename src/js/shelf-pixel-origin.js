// CSS layout uses fractional positions even when the retained room has an
// integral framebuffer. Choose the nearest integral CSS origin that also
// falls on a physical pixel. Fractional buffers keep their existing path.
export function shelfPixelOffset(top, width, height, ratio) {
  if (![top,width,height,ratio].every(Number.isFinite) || ratio <= 0
    || !Number.isInteger(width * ratio) || !Number.isInteger(height * ratio)) return 0;
  if (Number.isInteger(top * ratio)) return 0;
  let best = null;
  for (let candidate = Math.ceil(top + 4); candidate >= Math.floor(top - 4); candidate--) {
    if (!Number.isInteger(candidate * ratio)) continue;
    const offset = candidate - top;
    if (best === null || Math.abs(offset) < Math.abs(best)) best = offset;
  }
  return best ?? 0;
}
