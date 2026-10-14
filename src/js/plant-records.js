import { getCatalogPlant, getCatalogPot, getPotColor } from './plant-catalog-data.js';
import { plantDimensions, PLANT_REFERENCE_POTS } from './plant-dimensions.js';
import { tables } from './catalogue-core.js';

// Records saved by earlier versions name their species differently (Rust table).
const LEGACY_PLANTS = Object.freeze(tables.legacyPlants);

/** Every saved generation uses one of the current volumetric plant models. */
export function resolveCatalogPlant(entry = {}) {
  const explicit = getCatalogPlant(entry.catalogId);
  if (explicit) return explicit;
  const alias = String(entry.variant || entry.catalogId || '').trim().toLowerCase();
  return getCatalogPlant(Object.hasOwn(LEGACY_PLANTS, alias) ? LEGACY_PLANTS[alias] : 'monstera');
}

/** Complete old records without moving objects or resetting an empty collection.
 * `width` and `height` are always the real IKEA size in millimetres (see
 * plant-dimensions.js): a size saved by an earlier version (arbitrary pixels)
 * is replaced, while the place, seed, pot and colour are kept. */
export function normalizeShelfPlant(record) {
  if (!record || typeof record.key !== 'string' || !record.key.trim()) return null;
  const plant = resolveCatalogPlant(record);
  // Legacy records without a pot keep the original assembly. Only newly
  // selected plants explicitly receive the catalogue's compact default.
  const potId = getCatalogPot(record.potId)?.id || PLANT_REFERENCE_POTS[plant.id];
  const size = plantDimensions(plant.id, potId);
  return {
    ...record,
    ...(record.potColorId !== undefined ? { potColorId:getPotColor(potId,record.potColorId).id } : {}),
    seed:typeof record.seed === 'string' && record.seed ? record.seed : record.key,
    catalogId:plant.id,
    variant:plant.variant,
    potId,
    width:size.width,
    height:size.height
  };
}
