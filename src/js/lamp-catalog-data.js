import { LAMP_KELVINS } from './lamp-kelvin.js';
import { tables } from './catalogue-core.js';

/** Millimetres; the tripod is a compact interpretation of the supplied photo.
 * `light` names the lights a fixture needs in the room (see shelf-lamp-lighting),
 * known before its model exists so scrolling never changes the shader. The
 * table is built by the Rust core. */
export const LAMP_CATALOG = Object.freeze(tables.lampCatalog.map(lamp =>
  Object.freeze({ ...lamp, dimensions:Object.freeze(lamp.dimensions) })));

const byId = new Map(LAMP_CATALOG.map(lamp => [lamp.id,lamp]));
export const getCatalogLamp = id => byId.get(String(id || '')) ?? null;

/** Keep placement independent of screen pixels and reject unknown fixtures. */
export function normalizeShelfLamp(candidate) {
  if (!candidate || typeof candidate !== 'object') return null;
  const lamp = getCatalogLamp(candidate.lampId);
  const key = typeof candidate.key === 'string' && candidate.key.trim() ? candidate.key.trim()
    : typeof candidate.seed === 'string' && candidate.seed.trim() ? candidate.seed.trim() : null;
  if (!lamp || !key) return null;
  const seed = typeof candidate.seed === 'string' && candidate.seed.trim() ? candidate.seed.trim() : key;
  return {
    key,seed,lampId:lamp.id,isOn:candidate.isOn !== false,
    ...(Number.isFinite(candidate.shelf) && candidate.shelf >= 0
      ? { shelf:Math.min(999,Math.floor(candidate.shelf)) } : {}),
    ...(Number.isFinite(candidate.x) ? { x:Math.min(1,Math.max(0,candidate.x)) } : {}),
    // Older records carry none: the lamp's own 2700 K.
    ...(LAMP_KELVINS.includes(candidate.kelvin) ? { kelvin:candidate.kelvin } : {})
  };
}
