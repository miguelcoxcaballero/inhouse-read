// Shared fitted dimensions for rendered meshes and Rust contact shapes.
import {resolveCatalogPlant} from './plant-records.js';
import {getCatalogPot} from './plant-catalog-data.js';
import {plantDimensions} from './plant-dimensions.js';
import {getCatalogLamp} from './lamp-catalog-data.js';
import {needRustShelf} from './rust-shelf.js';
const host={resolveCatalogPlant,getCatalogPot,plantDimensions,getCatalogLamp};
export const plantGeometrySpec=entry=>needRustShelf().plant_geometry_spec(entry,host);
export const lampGeometrySpec=(options={})=>needRustShelf().lamp_geometry_spec(options,host);
