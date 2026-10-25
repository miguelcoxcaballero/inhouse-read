# Retained scene diagnostics

`RustSceneCounts` owns the diagnostic input, exact bit comparison, counters and
resolution text. The host writes object fields directly into retained WASM
memory. Unchanged input reuses the existing totals and string. Layout length
changes resize the arena; memory views refresh after WASM growth. Disposal frees
the native owner. The existing `scene_counts` API remains compatible.

This removes the per-frame JavaScript number list, its typed-array copy and
wasm-bindgen slice copy. It also avoids formatting every visible book's texture
resolution while positions move but diagnostic fields remain unchanged.

Validation: Rust release compilation, Vite production build, three retained-frame
tests and fourteen existing scene-entry differential tests passed. Tests cover
empty/resized layouts, NaN/infinite resolutions, cache invalidation, disposal
and memory growth.

The 14 scene frame-cost tests also passed. The full frozen-scene comparison
reported 16 differences among 26 cases (foliage coordinates and hit selection).
Replaying fractional units and seeds 1 and 2 against the pre-change scene
reproduced the same three failures at the same transcript offsets. These
differences were investigated in the subsequent matrix refresh correction.

A separate replay comparing this change directly with the pre-change scene,
using the same non-settling options, passed all four checks: deterministic
replay, fractional units and seeds 1 and 2.

Follow-up `4aa27f7` refreshes plant descendant matrices when rebuilding leaf
paths, and entry model matrices before ray tests. The full frozen-scene corpus
now passes all 26 cases, together with all 14 frame-cost checks (40 total).
Vite production compilation also passes. The per-frame room transform still
updates only its root; the targeted refreshes run when their matrices are used.

A local Node/WASM comparison used seven alternating rounds, 100 warmup calls and
2,000 measured calls per round, with unchanged visible book data. Median time per
call in microseconds (previous host packing + kernel versus retained adapter):

| Books | Previous | Retained |
| --- | ---: | ---: |
| 10 | 3.00 | 0.12 |
| 100 | 16.23 | 0.67 |
| 1,000 | 148.32 | 6.40 |

These measurements cover diagnostic packing, computation and output only. They
do not measure GPU rendering, device battery usage or total app performance.
