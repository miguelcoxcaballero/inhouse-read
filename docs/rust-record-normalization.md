# Reading and shelf record policies

`record_normalization.rs` owns saved places/quotes and shelf lamp validation in
both the shelf and reader/cloud WASM modules. The JavaScript entry points use
their already-loaded module; they introduce no extra request or asynchronous
step inside a storage transaction. Strings remain host UTF-16 values so limits
preserve JavaScript slicing, including a surrogate pair split at a boundary.

`shelf_metadata.rs` owns the metadata-only refresh decision. It preserves
explicit committed-byte stamps, exact Blob identity, unknown-field rejection,
bookmark equality and the existing whole-record comparator. This prevents a
metadata-only cloud/history update from unnecessarily rebuilding the layout;
it does not loosen the existing conditions for retaining a shelf. Recursive
identity checks use an explicit Rust stack and report unsupported cycles
without overflowing the smaller WASM stack.

Host adapters retain Object/Array/String primitives, catalogue handles, the
existing Rust-backed bookmark/comparison functions and browser object identity.
This is policy migration; no performance gain is claimed for small object
normalization by itself. No rendering settings, lamp appearance or physics
constants change.

Validation against compiled production WASM:

- 163 tests pass across 11 files, including existing reading-state,
  shelf-metadata, catalogue/lamps, cloud sync/backup, reader actions/lifecycle
  and shelf metadata-reference tests.
- New differential tests compare the frozen previous implementations over
  generated reading records and limits, 1,200 lamp records and 600 Blob/stamp
  scenarios. They cover optional field presence/order, PDF text offsets,
  malformed input, sparse arrays, filter-before-limit errors, getter order,
  UTF-16 truncation and unsupported cyclic metadata.
- The same record functions are checked directly in the independent UI module,
  in addition to production calls through the shelf module.
- Rust UI/shelf and the production web/offline-shell build pass. Browser/GPU
  rendering is unchanged by this batch; no new GPU test result is claimed.

The earlier functional boundary audit is a snapshot at `5636c584`; this batch
resolves its `reading-state`, `shelf-metadata-records` policies and the
`normalizeShelfLamp` part of `lamp-catalog-data`. Other mixed modules listed in
that audit remain separate work.
