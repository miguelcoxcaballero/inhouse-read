# Retained foliage hit targets

The scene packs book and lamp exclusion rectangles once per frame into a Rust arena. Each plant retains its local matrix, furniture rotation, projection reference and last clip inputs in Rust. The native state decides whether leaf triangles need projecting again and whether their SVG exclusion path changed. DOM construction, Three objects and writing SVG attributes remain browser bindings.

The former bridge created one variable-length `Float64Array` per plant and frame, packed all exclusion rectangles repeatedly, and copied both old and new arrays through wasm-bindgen. The new adapter writes a shared native exclusion buffer once and 26 pose/rectangle numbers per visible plant. Buffers and their capacities survive frames; views refresh after WASM memory growth. Native snapshots also preserve a hidden plant's cache when other objects move away and return before it is visible again. NaN retains JavaScript's unequal-to-itself invalidation behavior.

Model replacement, culling and disposal release the native states. A semantic node replacement transfers its existing state alongside its cloned SVG, preserving the leaf geometry and holes without rebuilding them. Frame disposal releases any remaining states. Projection math, clipping arithmetic, leaf geometry, renderer resolution and materials are unchanged.

Validation includes exact clip strings and projection invalidation over 700 frames with eight plants, camera translation/zoom/turns, changed and reordered occluders, model replacement, invisible intervals, degenerate coordinates, shared-memory growth and repeated disposal. Existing scene matrix, foliage hit-target, lifecycle and independent scene-transcript tests exercise the integration. A mobile Chromium test drags a plant by its leaves directly into the bin and verifies the survivor and saved state; it passed in 57.9 seconds without page errors.

Run the isolated bridge benchmark with:

```sh
node scripts/benchmark-foliage-frame.mjs /tmp/foliage-frame-benchmark.json
```

It verifies exact clip outputs, then alternates 25 timed rounds of the complete old and new host/native paths. On this shared cloud host, stationary inputs took 0.0058 → 0.0015 ms for 24 occluders/four plants, 0.0173 → 0.0031 ms for 96/eight, and 0.0442 → 0.0049 ms for 240/twelve. When scrolling changed clip inputs every frame, the measured improvement was only 3–6% (0.0500 → 0.0485, 0.1228 → 0.1170 and 0.2760 → 0.2611 ms). These numbers isolate hit-target bookkeeping, including bridge costs; they are not rendering, application FPS or mobile battery measurements.
