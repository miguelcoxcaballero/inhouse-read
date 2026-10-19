# Rust cover kernels — 1.7.304

The cover analyzer now requires the same numeric Rust core as the shelf. It no longer runs JavaScript copies of color clustering, glyph extraction, grayscale/edge preparation, visual classification, or title-mask scoring during cold startup or worker failure. Canvas decoding/font rasterization remain browser adapters.

The worker receives the page's compiled WebAssembly.Module through structured cloning and instantiates its own isolated memory. This avoids a second fetch/compilation. If module workers fail or time out, scoring continues using the page's Rust instance, in resumable coarse-row/refinement steps. The image uploads once for that job. Scheduling still yields at 2 ms and parks while the reader owns the screen. Worker scoring retains the existing uninterrupted native kernel. Both message ports now close after each scheduler yield.

Verification:
- 118 cases in 12 targeted unit suites passed: exact f64 scores, all grayscale RGB combinations, glyph bytes/point order, cold worker ordering, compiled-module handoff without fetch, worker failure, cancellation, memory growth and balanced release.
- Five browser cases passed: real shelf appearance persisted identically to the frozen reference, the full analyzer with and without a real module worker, and PDF/EPUB reading with page navigation/audio controls/return.
- PDF and EPUB idle observations each recorded zero RAF callbacks, zero WebGL draws and zero worker messages over eight seconds; software Chromium, not physical phone battery measurement.
- Production build and shared updater verification passed. No Android APK or updater catalog changed.

Inventory: 36,577 Rust / 21,066 JavaScript nonblank production lines = 63.45%. This is the unchanged source inventory definition, not functional completion. Browser/Three.js adapters, shader source strings and compatibility code remain in that denominator. The full application migration is still incomplete.
