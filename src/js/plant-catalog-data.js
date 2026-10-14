import { tables } from './catalogue-core.js';

/** `width` and `height` are the real IKEA size in millimetres (the standard
 * class shown on the shelf); the tables are built by the Rust core. */
export const PLANT_CATALOG = Object.freeze(tables.plantCatalog.map(plant => Object.freeze(plant)));
export const POT_CATALOG = Object.freeze(tables.potCatalog.map(pot => Object.freeze(pot)));

const plantsById = new Map(PLANT_CATALOG.map(item => [item.id,item]));
const potsById = new Map(POT_CATALOG.map(item => [item.id,item]));
export const getCatalogPlant = id => plantsById.get(String(id || '')) ?? null;
export const getCatalogPot = id => potsById.get(String(id || '')) ?? null;

// Finish palettes are material choices, rather than a universal colour picker.
export const POT_COLORS = Object.freeze(Object.fromEntries(Object.entries(tables.potColors).map(([potId, colors]) =>
  [potId, Object.freeze(colors.map(color => Object.freeze(color)))])));
const colorsOf = potId => {
  const model = getCatalogPot(potId)?.modelId || potId;
  return typeof model === 'string' && Object.hasOwn(POT_COLORS, model) ? POT_COLORS[model] : POT_COLORS.muskot;
};
export const getPotColors = colorsOf;
export const getPotColor = (potId, colorId) => colorsOf(potId).find(color => color.id === colorId) || colorsOf(potId)[0];
