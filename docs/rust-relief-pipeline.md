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
