import { getCatalogPlant, getCatalogPot, getPotColor } from './plant-catalog-data.js';

const LEGACY_PLANTS = Object.freeze({
  upright:'sansevieria', sansevieria:'sansevieria', monstera:'monstera',
  leafy:'hedera', pothos:'hedera', ivy:'hedera', hedera:'hedera',
  suculenta:'succulent', succulent:'succulent', cactus:'cactus',
  palm:'chamaedorea', chamaedorea:'chamaedorea',
  fern:'nephrolepis', nephrolepis:'nephrolepis',
  zz:'zamioculcas', zamioculcas:'zamioculcas'
});

/** Every saved generation uses one of the current volumetric plant models. */
export function resolveCatalogPlant(entry = {}) {
  const explicit = getCatalogPlant(entry.catalogId);
  if (explicit) return explicit;
  const alias = String(entry.variant || entry.catalogId || '').trim().toLowerCase();
  return getCatalogPlant(LEGACY_PLANTS[alias] || 'monstera');
}

/** Complete old records without moving objects or resetting an empty collection. */
export function normalizeShelfPlant(record) {
  if (!record || typeof record.key !== 'string' || !record.key.trim()) return null;
  const plant = resolveCatalogPlant(record);
  const potId = getCatalogPot(record.potId)?.id || plant.defaultPotId;
  return {
    ...record,
    ...(record.potColorId !== undefined ? { potColorId:getPotColor(potId,record.potColorId).id } : {}),
    seed:typeof record.seed === 'string' && record.seed ? record.seed : record.key,
    catalogId:plant.id,
    variant:plant.variant,
    potId,
    width:Number.isFinite(record.width) && record.width > 0 ? record.width : plant.width,
    height:Number.isFinite(record.height) && record.height > 0 ? record.height : plant.height
  };
}
