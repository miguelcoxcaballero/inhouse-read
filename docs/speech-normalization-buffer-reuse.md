# Bounded native speech normalization buffers

Repeated speech preparation now leases initialized text, source-offset and
paragraph-boundary slabs from a Rust pool. The pool holds at most one buffer
set whose actual allocated capacity totals no more than one MiB.

The normalizer still writes every output prefix with the existing kernel.
Logical text/map/break lengths are separate from the retained initialized
slab lengths; only those logical prefixes are exposed or used by sentence
planning. Previous contents outside the prefixes cannot enter the result.
No uninitialized memory or new unsafe operation is introduced.

A lease owns its buffers until sentence planning/serialization completes.
The thread-local RefCell is released before browser callbacks, so nested
preparations obtain independent buffers. Normalized data returns its buffers
on drop, including callback-error paths after normalization. Oversized sets
are freed rather than retained; this is not a cache of book text or plans.

This avoids allocating and zero-filling all three slabs on each preparation
once a sufficiently large reusable set exists. The removal mask, output
serialization and sentence decisions are unchanged. No eager download or
additional dependency is required.

Validation: Rust UI/shelf WASM and Vite production compilation. This change
has not been profiled on a physical phone.
