# Shared decorative geometry and mounting composition

The shelf WASM module owns `plant_geometry_spec`, `lamp_geometry_spec`,
`layout_shelf_decorations` and `move_shelf_decoration` in `decor_adapters.rs`.
The public JavaScript modules are synchronous bindings with the original API.
They run after the shelf module is ready, without changing app startup, reader
activation, wake locks, object models or render resources.

Plant and lamp fitting retain the catalogue object identities and the exact
numeric rules used by both contact shapes and rendered meshes. The existing
catalogue lookup and dimensions APIs remain shared dependencies; this block
does not duplicate their data or their independent migration.

Placement still uses the existing numeric Rust packing core. This module owns
which mounting surface receives a move, completion of the other surface,
joining the rows, and the complete placement snapshot. It preserves the order
of metadata getter effects and permits synchronous nested layout calls. Book,
plant and standing-lamp collisions stay on the floor; undershelf lights have
an independent ceiling surface.

Typed property bindings access ordinary JavaScript records without creating
reflected field-name strings in the pointer loop. The fixed data rows produced
by the packing adapter are copied in bulk; source metadata remains opaque and
is copied by that existing adapter. Placement dictionaries use Object.fromEntries
so a literal `__proto__` book key remains an own data property.

Validation compares 1,200 mixed layouts and moves against the frozen original
composition, plus all catalogue choices with finite, missing, string and
non-finite fitting dimensions. Additional cases cover accessor ordering,
reentrant placement, sparse arrays, duplicate and special keys, ceiling-only
rows, original metadata identity and native handle lifetime. Tests of the
actual plant/lamp builders and placement integration run alongside this suite.

The remaining JavaScript object boundary has a measurable CPU cost. In a local
Node microbenchmark of 500 direct moves, nine alternating warmed rounds, median
milliseconds were original → native: 1 object 4.69 → 8.97; 12 objects 8.74 → 18.43;
40 objects 17.26 → 43.48. The typed binding reduced the first port's 40-object
result from 105.99 ms to 43.48 ms, but this block is a logic migration, not a
speedup of direct placement. Its added cost is approximately 9–52 microseconds
per direct call in this fixture. The existing persistent drag-session path is
unchanged. These numbers do not measure rendering, whole-app responsiveness or
device battery use.
