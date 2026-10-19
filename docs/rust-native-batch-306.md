# Native geometry and cover metadata — 1.7.306

Three independently reviewed kernels are integrated over 1.7.305:

- Binding relief: the owned 256×1024 RGBA raster is sampled in one Rust batch rather than up to 37,345 JavaScript callbacks. External callback samplers keep their original order, reentrancy and failure behavior. Complete mesh buffers are byte-identical. Local full-bridge CPU benchmark: 1.32× shelf, 1.56× overview, 1.64× detail.
- Paper geometry: both pastedown and reading-paper positions, shading, normals, UVs and indices are generated in one Rust call. Float32 rounding order matches Three.js. Exact parity across 182 physical dimension cases. Local 5,000-pair construction benchmark including attribute installation: 75.00 ms → 33.20 ms; this small kernel does not imply a comparable application FPS gain.
- Cover metadata: color, shade, contrast and rounding are produced with clustering in one Rust call. A cached 256-channel luminance table avoids repeated powers. All 16,777,216 RGB combinations produce the exact same strings. Local median 0.113 → 0.110 ms; the gain is small.

Combined validation:
- 222 unit cases across 12 suites passed with the combined app/decor/voice WASM build.
- Eight Chromium cases passed: exact real-worker and main-thread-only cover appearance, native cover metadata, delayed module and WASM readiness without blocking animation frames, stored production glyph appearance, book textures and reflections.
- Production build and shared updater verification passed. No APK or updater catalog changes.
- The delayed-module/download browser tests now exercise native readiness and responsive animation frames. Their old assumptions of JavaScript numeric fallback no longer apply after 1.7.304; they must release a held static module before waiting for module initialization.

Unchanged source inventory definition: 36,746 Rust / 21,056 JavaScript nonblank production lines, 63.57%. This is source composition, not functional completion. Remaining work includes scene-state packing and orchestration, relief job buffers, lifecycle/cache policy and live synchronization coordination; browser and Three.js API adapters remain necessary. This release does not complete the Rust migration.
