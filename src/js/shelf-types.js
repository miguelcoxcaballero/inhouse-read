import { tables, freezeDeep } from './catalogue-core.js';

// The cabinets' measures (IKEA's published sizes and the positions checked
// against its assembly drawings) are tables of the Rust core.
export const BAGGEBO_SPEC = freezeDeep(tables.baggebo);
/** The wooden cabinet is built to the same outer size and compartments as the
 * BAGGEBO, so both types share one set of measures (mm). */
export const WALNUT_SPEC = freezeDeep(tables.walnut);
export const SHELF_SPECS = Object.freeze({ walnut:WALNUT_SPEC, baggebo:BAGGEBO_SPEC });
export const SHELF_TYPES = Object.freeze(tables.shelfTypes.map(type => Object.freeze({ ...type, dimensions:SHELF_SPECS[type.id].dimensions })));

export function normalizeShelfType(id) {
  const normalized = typeof id === 'string' ? id.trim().toLowerCase() : '';
  return SHELF_TYPES.some(type => type.id === normalized) ? normalized : 'walnut';
}

export function getShelfType(id) {
  return SHELF_TYPES.find(type => type.id === normalizeShelfType(id));
}
