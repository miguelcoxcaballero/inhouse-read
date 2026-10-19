import { layoutShelvedObjects, moveShelfObject } from './shelf-placement.js';
import { needRustShelf } from './rust-shelf.js';

// Rust composes the independently packed standing and undershelf surfaces,
// preserving metadata and the order of reentrant host placement operations.
export const layoutShelfDecorations = (objects,options) =>
  needRustShelf().layout_shelf_decorations(objects,options,layoutShelvedObjects);
export const moveShelfDecoration = (objects,key,target,options) =>
  needRustShelf().move_shelf_decoration(objects,key,target,options,layoutShelvedObjects,moveShelfObject);
