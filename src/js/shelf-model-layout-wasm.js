import { needRustShelf } from './rust-shelf.js';

// One cabinet operation crosses into the numeric core; the Rust shelf module makes the request
// (rust-ui/src/shelf_model_host.rs): it reads the measured entries, writes the core's arena, calls
// `shelf_model` and builds the modelled rows and entries, each a copy of the measured one. The core is
// the only implementation: measured geometry of a hidden or collapsed shelf (zero, negative or NaN
// sizes) is laid out with the original arithmetic, not rejected; an engine that cannot answer gives null.
export const rustShelfModelLayout = (core, layout, spec, shelfType, bookHeight) =>
  needRustShelf().shelf_model_request(core, layout, spec, shelfType, bookHeight);
