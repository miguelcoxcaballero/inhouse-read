# Native plant surface lifecycle

`rust-ui/src/plant_surface_queue.rs` owns plant painting dispatch, the idle slice
budget (four rows per chunk, at most 48 chunks and the existing 5–16 ms time
budget), shared-source completion, disposed-clone removal, failure retries and
the most recent twelve saved plant bakes. The native validator and collector
continue to reject incomplete textures and invalid saved geometry.

`src/js/shelf-plants.js` retains the Three.js texture constructors, event listener
bindings, existing numeric decor-kernel adapters and the browser's idle-work
gate. That gate parks work on the reader ownership/visibility signal; migration
does not add a polling timer. Generation dimensions, coarse previews, pigments,
roughness, geometry and source upload versions remain unchanged.

State is an ordinary object containing browser-owned handles. No Rust mutable
borrow crosses a painter, disposal or redraw callback, so reentrant notifications
can safely create another plant. Completed waiters and disposed clones are
released; no new persistent Wasm allocation stores pixel copies.

Verification covers byte/scene parity against the frozen original plant
models, restoring all catalog plant/pot combinations from saved bakes,
inspection cancellation and color changes, failure recovery, shared source
versions, the original queue's scheduling trace, reader pause/resume and stable
Wasm handle counts. This is a lifecycle migration; it does not claim a measured
whole-app speed or battery improvement.

The following appearance/lifecycle block lives in
`rust-ui/src/plant_surface_policy.rs`: canonical variant selection, UTF-16 seed
conversion and deterministic random offsets, botanical/pot/soil descriptors,
material coefficients, preparation/apply/cancel of inspection maps, palette
changes, UV-preserving map replacement and disposal. Texture constructors and
GC-owned callbacks remain browser bindings. Descriptor tests cover every pot
palette and plant family at both resolutions. Additional tests cover partial
preparation failures, changing colour while inspection is pending and stable
Wasm handle counts after repeated cancellation and disposal.

Saved plant record resolution/normalization is owned by
`rust-ui/src/plant_records.rs`. It preserves catalog object identity, alias
precedence, explicit versus legacy pots, seed/position/orientation fields and
palette repair. Ordered data-property copying retains enumerable symbols and
own `__proto__` fields without invoking prototype setters. Invalid getters and
string conversions propagate through caught host calls so Rust releases every
intermediate handle. No extra startup fetch is introduced: shelf callers
already await the shelf module before constructing or normalizing shelf items.
