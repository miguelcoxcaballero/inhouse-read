import { LAMP_KELVINS } from './lamp-kelvin.js';
import { tables } from './decor-catalogue.js';
import { bookDataModule } from './book-data-native.js';

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
  return bookDataModule().record_normalize_lamp(candidate, byId, LAMP_KELVINS);
}
