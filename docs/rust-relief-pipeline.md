# Scoped Rust cover relief rendering

`relief_render_*` keeps a single job alive through coating-strength composition,
normal generation and optional grayscale-to-RGBA expansion. The JavaScript
bridge uploads each needed input once and copies only final owned output arrays.
The normal/RGBA output slot is reused between planes. Strength recomposition
reuses the classification-height scratch buffer after that input is consumed.
No native pointer or process-wide map cache survives the generator's `finally`.

`buildReliefMaps` uses the normal/RGBA pipeline; `updateReliefMapStrengths` uses
composition/normals. Material-finish changes retain their existing independent
bake API. Existing standalone exports remain available. Cancellation, native
memory growth between yields, concurrent jobs, per-pigment boundaries and normal
selection alpha retain their previous behavior. Flat normal gradients use the
exact `[128,128,255]` result without unnecessary square roots or divisions.

Validation uses complete byte comparisons against frozen JavaScript references,
all layer strengths, cancellation during each stage, interleaved jobs, native
memory growth, and the real browser build/update APIs. Run:

```
npx vitest run tests/unit/relief-pipeline-wasm.test.js
npx playwright test tests/e2e/rust-relief-pipeline.spec.mjs
node scripts/benchmark-relief-pipeline.mjs report.json /path/to/previous-core.wasm
```

The benchmark includes inputs, native passes, final copies and job disposal.
It alternates old/new paths after warmup and checks stable native capacity.
Against the 1.7.306 artifact, local runs of 128×193, 288×384 and 512×512
fixtures measured 1.03–1.68× faster bakes; these are CPU-stage measurements,
not whole-app performance or device battery claims. At 512×512 the normal/RGBA
path's WASM capacity was 3,538,944 bytes versus 7,012,352 bytes before; both
stayed stable over repeated bakes. Noise and structured coating fixtures retain
identical final bytes.

## Portable policy and rendering plans

`cover_relief_portable.rs` owns validation/normalization of persisted choices,
first-ten layer selection and colour deduplication. Both the reader/Drive and
shelf modules compile this small shared policy; `bookDataModule()` uses whichever
module is already loaded, so normalizing Drive metadata never fetches Shelf.

`cover_relief.rs` owns canonical layer ordering and compatibility checks,
classification profiles, raster validation, raster/thumbnail sizing, rendering
coefficients, proposal metadata and timing percentiles. Pixel buffers retain
identity while metadata is packaged. Normalization preserves coercion, getter
order, errors, rounding and independently owned result objects. Ordinary timing
arrays sort in Rust; unusual inputs use the engine's stable sort with a scoped
Rust comparator to retain JavaScript's NaN/undefined behavior.

Canvas/ImageData, image decoding, AbortSignal, cooperative generator yields and
browser timers remain host operations. The existing pixel pipeline and cache
interfaces are unchanged. Differential tests include thousands of portable
records, malformed values, conversion errors, legacy records, size boundaries,
metadata identity and repeated-call handle counts. Run:

```
npx vitest run tests/unit/relief-policy-native.test.js tests/unit/multicolor-cover-relief-persistence.test.js
```
