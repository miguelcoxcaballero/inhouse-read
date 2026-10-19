import { getCatalogPlant, getCatalogPot, getPotColor } from './plant-catalog-data.js';
import { plantDimensions, PLANT_REFERENCE_POTS } from './plant-dimensions.js';
import { tables } from './decor-catalogue.js';
import { needRustShelf } from './rust-shelf.js';

// Catalogue objects remain browser-owned; Rust resolves and normalizes records
// without moving their saved positions or replacing explicitly selected pots.
const host = { getCatalogPlant, getCatalogPot, getPotColor, plantDimensions,
  referencePots:PLANT_REFERENCE_POTS, legacy:Object.freeze(tables.legacyPlants) };
export const resolveCatalogPlant = entry => needRustShelf().plant_resolve_record(host,entry);
export const normalizeShelfPlant = record => needRustShelf().plant_normalize_record(host,record);
