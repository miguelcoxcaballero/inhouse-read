# Ribbon and paper surface policy

`book_surface_policy.rs` owns ribbon dye selection, material values and colored
sheen, fine cloth/laminate strength, paper-color cache identity and the page's
sRGB blend. The existing Three color parser and color-space conversions remain
host operations. Finished-book gold, weighted dye contrast, seeded selection,
roughness, anisotropy, tint and normal strengths are unchanged.

The animation-time blend reads both converted RGB colors in one bulk binding,
interpolates the three channels in Rust, then calls Three once to store them.
It preserves target aliases, null paper sides, clamping/NaN behavior and exact
component values. The cache has weak keys and no native callbacks or futures.
A missing tone is cached exactly as before; read/conversion errors can retry.

Validation includes 20,000 seeded color selections, 6,000 paper blends with
aliased destinations and out-of-range components, quality thresholds, material
recipes, cache identity/errors, and the existing page/theme/model/relief suites.
158 tests across six files passed; after batching the blend, the 100 affected
model/theme/policy tests passed again with the final binary.
The explicit-GC benchmark checks that 300 weak references to paper keys, source
rasters and host bindings are collected. Repeated blends do not grow native
handle counts or WASM memory after warmup.

The first property-by-property bridge cost 14–16 microseconds per blend versus
about 0.5–0.7 microseconds for JavaScript on a shared runner. It was replaced by
the bulk color binding before publication. The final shared-runner probe measured
2.6–5.1 microseconds per blend (JavaScript 0.3–0.7); selection measured 1.6–3.2
microseconds (JavaScript 1.1–2.4). These are bounded migration costs, not a claimed
speedup over the original JS. The benchmark is reproducible with
`node --expose-gc scripts/benchmark-book-surface-policy.mjs`. There is no GPU,
quality, battery or overall frame-rate speedup claim from this CPU-only probe.
