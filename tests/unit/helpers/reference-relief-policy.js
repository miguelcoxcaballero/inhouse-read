// Frozen portable/sizing/statistics rules before their Rust migration.
export const COLOR_RELIEF_IDS = Object.freeze(Array.from({ length:10 }, (_, index) => `color-${index + 1}`));
export const LEGACY_RELIEF_IDS = Object.freeze(['lettering', 'foil', 'frame', 'emblem', 'varnish', 'band', 'grain', 'panel']);
export const RELIEF_IDS = Object.freeze([...COLOR_RELIEF_IDS, ...LEGACY_RELIEF_IDS]);
export const DEFAULT_RELIEF_STRENGTH = .75;
export const DEFAULT_COLOR_TOLERANCE = 6;
export const MIN_COLOR_TOLERANCE = 1;
export const MAX_COLOR_TOLERANCE = 12;
export const WORK_SIZE = 288;
export const MAP_SIZE = 512;

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

/** Validate portable color choices and old family records; discard map data. */
export function normalizeCoverRelief(value) {
  if (value && typeof value === 'object' && Array.isArray(value.layers)) {
    const layers = [], colors = new Set();
    for (const entry of value.layers.slice(0, 10)) {
      // Nested selections, legacy families and decoded rasters never become
      // layers. A portable layer names one actual supported printed colour.
      const layer = entry && !Array.isArray(entry.layers) && normalizeCoverRelief(entry);
      if (!layer || !COLOR_RELIEF_IDS.includes(layer.id) || colors.has(layer.color)) continue;
      layers.push(layer); colors.add(layer.color);
    }
    return layers.length ? { layers } : null;
  }
  if (!value || typeof value !== 'object' || !RELIEF_IDS.includes(value.id)) return null;
  const number = value.strength == null ? DEFAULT_RELIEF_STRENGTH : Number(value.strength);
  const strength = Number.isFinite(number) ? Math.round(clamp(number, 0, 1) * 100) / 100 : DEFAULT_RELIEF_STRENGTH;
  if (COLOR_RELIEF_IDS.includes(value.id)) {
    if (typeof value.color !== 'string' || !/^#[\da-f]{6}$/i.test(value.color)) return null;
    const tolerance = value.tolerance;
    if (!Number.isFinite(tolerance) || tolerance < MIN_COLOR_TOLERANCE || tolerance > MAX_COLOR_TOLERANCE) return null;
    return { id:value.id, color:value.color.toLowerCase(), tolerance:Math.round(tolerance * 100) / 100, strength };
  }
  return { id: value.id, strength };
}

/** Colour-only editor access. Legacy family choices remain readable and are
 * rendered through the first detected colour without being silently rewritten. */
export function coverReliefLayers(value) {
  const normalized = normalizeCoverRelief(value);
  if (normalized?.layers) return normalized.layers;
  return normalized && COLOR_RELIEF_IDS.includes(normalized.id) ? [normalized] : [];
}

export function quantile(values, fraction) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
}

// ---- rasters -----------------------------------------------------------------

export function fitDimensions(width, height, long) {
  const scale = Math.min(1, long / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export function validateRaster(image) {
  if (!image || !Number.isSafeInteger(image.width) || !Number.isSafeInteger(image.height)
    || image.width < 1 || image.height < 1 || !image.data || image.data.length !== image.width * image.height * 4) {
    throw new TypeError('Portada sin píxeles RGBA válidos');
  }
}

