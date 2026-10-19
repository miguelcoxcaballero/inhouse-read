import { layoutShelvedObjects } from './shelf-placement.js';
import { needRustShelf } from './rust-shelf.js';

// Rust owns rooftop grouping, unit growth and placement annotations. The
// callback retains the existing numeric placement core and its host records.
const host = { layout:layoutShelvedObjects };
export const placeRooftopPlants = layout => needRustShelf().plant_rooftop_layout(host, layout);
