# Native projections from the first shelf frame

The shelf awaits Rust Shelf before its first frame. Rust UI is intentionally deferred until a reader or catalogue is opened. The book and foliage projection adapters previously consulted only UI, so the normal home screen continued to execute their JavaScript implementations even though Shelf was ready.

Both existing kernels are now compiled into Shelf as well as UI, from the same Rust source files. Each adapter prefers the existing UI capability, then uses the already-loaded Shelf capability. It does not load, wait for, or initialize a module. A genuinely cold consumer still gets the original implementation. Unsupported custom foliage attributes and declined packets retain their existing per-mesh fallback. A failure from a preferred ready module still falls back directly, without switching ownership to another module.

Three traversal, bounding-box creation, typed-array packing and browser module readiness remain host operations. Rust owns corner transforms, camera projection, extrema, foliage transforms, triangle facing, decimal formatting and the resulting SVG path. No geometry, quality setting, clipping threshold or output precision changed.

The isolated Shelf artifact grows from 3,989,922 to 3,998,878 bytes: 8,956 bytes (0.22%). The UI artifact is unchanged. There is no new download or second runtime instance on the home screen.

## Verification

- `projection-runtime.test.js`: 22 tests, including all 806 book-bound cases and all eight production plant models at six poses. With UI absent and Shelf ready, spies require zero legacy calls. Exact results are compared to independently imported original implementations, including IEEE edge values.
- Cold startup, late Shelf readiness, later UI readiness, UI priority, incomplete capabilities and custom attributes preserve their prior behavior. Native memory, retained references and host packet capacity remain stable through 23 complete repeated projection batches.
- Existing projection suites: 52 tests, including over 300,000 decimal-format cases and 400 random foliage meshes. Their legacy/UI isolation is explicit, so the new Shelf route cannot silently replace a reference case.
- Book-model, compact-motion, adaptive-frame, foliage-frame and scene-scheduling integration: 117 tests. The compact-motion legacy/UI cases explicitly hide only Shelf's projection capability, preserving their independent old-route coverage.
- No GPU, device temperature, battery or whole-app frame-rate claim is made by these CPU checks.

## Complete-call measurement

Run `npx vite-node scripts/benchmark-projection-runtime.mjs report.json`. The benchmark asserts exact results before measuring. UI stays absent throughout; timings include traversal, packing, projection and complete SVG text creation. Plant models are the actual production geometries. Book groups use representative Three meshes. Medians are from 21 alternating rounds on a shared host.

| Work | Original JS, ms | Ready Shelf, ms | Ratio |
| --- | ---: | ---: | ---: |
| Book, 8 visible meshes | 0.00386 | 0.00356 | 1.08× |
| Book, 32 visible meshes | 0.00988 | 0.00705 | 1.40× |
| Book, 128 visible meshes | 0.04034 | 0.02737 | 1.47× |
| Monstera | 2.70844 | 0.90459 | 2.99× |
| Sansevieria | 1.01917 | 0.29251 | 3.48× |
| Chamaedorea | 1.15662 | 0.53954 | 2.14× |
| Nephrolepis | 3.16738 | 1.47868 | 2.14× |
| Zamioculcas | 2.39701 | 0.87341 | 2.74× |
| Hedera | 1.53870 | 0.47598 | 3.23× |
| Cactus | 1.55456 | 0.85169 | 1.83× |
| Succulent | 2.44173 | 0.90640 | 2.69× |

The eight-mesh result is small enough to treat as comparable cost. The meaningful improvement is enabling native foliage projection on the initial home screen, rather than only after opening a deferred UI surface. These calls are already gated by the scene's native foliage cache; the change does not add projection work to stationary frames.

Remaining JavaScript in the scene and shelf facade primarily owns Three/browser object access, event and timer registration, renderer application, geometry/material resources and host object representation. Numeric frame policies, caches and decisions migrated in the preceding scene batches remain native. Model lifecycle, room coordination and other app domains have separate owners; this audit is not a claim that every application domain is finished.
