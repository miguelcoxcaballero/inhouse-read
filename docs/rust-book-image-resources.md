# Rust decoded-cover leases and paper-tone caches

`rust-ui/src/book_image_resources.rs` owns shared decoded cover entries, listener dispatch, lease counts, idempotent release, the existing six-second remote timeout, retries and warm-up ownership. Retired loads cannot revive an evicted image or evict a newer lease of the same URL. Temporary loader textures are disposed even if a consumer callback fails; a synchronous loader failure also releases the lease and timer.

The same module owns paper-tone weak identities, sharing permissions, cached RGB/null results, concurrent-job deduplication, cancellation decisions, result validation and pending-entry cleanup. The JavaScript adapters retain Three's image loader, Canvas readback and the browser's bitmap/Worker message transport, including abort listener removal and transfer cleanup. Rust callbacks are bound JavaScript functions with GC-owned state, not Rust futures retaining an image indefinitely.

`rust-core/src/paper_tone.rs` samples the exact 44 outer pixels of a 12×12 RGBA raster. Alpha must exceed 200; at least 16 opaque samples and at most 20 levels between the original integer quartiles are required. It uses fixed stack arrays and returns packed RGB or null. The host owns and frees a 576-byte scratch arena before returning the RGB triplet.

The sampling worker receives the already-compiled app `WebAssembly.Module`; it does not import the shelf/reader module or download another binary. If that compiled module is unavailable, preparation returns false and keeps the synchronous sampler available. The worker's instance is released when the worker terminates. Page bitmaps are still transferred once and closed on success, failure, or cancellation.

The shared-runner app instance starts with 1,114,112 bytes of memory; a 100-instance measurement averaged approximately 0.325 milliseconds for instantiation. That extra temporary worker cost is separate from the faster numeric kernel, and is not a claim that total worker latency improved.

A CPU-only measurement including input copy, allocation/free and RGB conversion produced 0.75–0.79 microseconds per sample versus 6.81–7.52 for the previous JS algorithm (three batches of 20,000 calls). Canvas readback and bitmap transfer are outside that benchmark; it does not measure frame rate, startup, battery or device temperature.

Validation includes the original cover/paper suites, 700 deterministic differential rasters, late retired loads, throwing consumers, synchronous load failures, abort during bitmap creation, no-fetch worker rejection and 1,000 repeat leases/samples with unchanged WASM memory and live-handle counts.

Verification: isolated app/decor/voice and UI/shelf release builds succeeded; the native Rust sampler test passed. All 143 tests passed in nine focused unit suites (15.17 seconds). No browser/GPU/device performance run was performed for this isolated worktree.
