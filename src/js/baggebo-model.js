import * as THREE from 'three';
import { needRustShelf } from './rust-shelf.js';
import { BAGGEBO_SPEC } from './shelf-types.js';

const closures = state => ({ dispose:() => needRustShelf().baggebo_dispose(state) });

/** BAGGEBO 504.811.72. Coordinates are millimetres at width=600: x centred,
 * top y=0, feet y=-1160, front z=0 and back z=-250. Uniform scaling preserves
 * the real proportions; the original has three internal shelves and a mesh top.
 * The fit, the geometry, the materials and the three.js objects are made by the
 * Rust shelf module (rust-ui/src/decor_build.rs), which keeps the finished
 * furniture as data and gives every model its own copy of the buffers. */
export const createBaggebo = options => needRustShelf().baggebo_create(THREE, options, BAGGEBO_SPEC, closures);
