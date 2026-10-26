import * as THREE from 'three';
import { needRustShelf } from './rust-shelf.js';

const closures = state => ({ dispose:() => needRustShelf().catalog_dispose(state) });

/** A saddle-stitched paper catalogue hanging from a steel bulldog clip on a pin in the outside
 * of the cabinet; local +Z is the cover, -Z faces the cabinet wall. Its cover art, model and
 * three.js objects are made by the Rust shelf module (rust-ui/src/decor_build.rs). */
export const createShelfCatalog = options => needRustShelf().catalog_create(THREE, document, options, closures);
