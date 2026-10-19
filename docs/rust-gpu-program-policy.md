# Rust GPU program preparation policy

`gpu_program_policy.rs` owns program retention (including the 160-program cap), visible/prepared object selection, shader readiness deadlines, idle uniform reflection, transmission-pass preparation and visibility-aware polling/cancellation. Three and WebGL stay in the browser. Shader source, material settings, render resolution and the half-float transmission target are unchanged.

Pending promises and timers use garbage-collectable bound JavaScript callbacks into Rust exports. Weak collections preserve renderer/program identity without keeping disposed renderers alive. A failed transmission compile restores the previous target and disposes the temporary target. Hidden documents park polling until their visibility event; cancellation releases the exact event callback and pending timer.

The render hook batches WeakSet membership of opaque Three program objects in one browser binding. Rust owns the collection and retention limit, and processes only new programs. Performing one WASM/property round trip for every already-retained program measured roughly 172–191 microseconds per render with 100 programs and was rejected before committing. The batch does not rely on unchanged array lengths: replacing an entry or the entire program list remains observable. Duplicate references count only once.

Run `node scripts/benchmark-gpu-retention.mjs` after building Rust UI/shelf to compare steady-state CPU interop cost against the previous JavaScript policy. This is a microbenchmark of cache bookkeeping, not a measurement of GPU rendering, frame rate, battery consumption or mobile temperatures.

On the shared Linux runner, the median of five 20,000-call batches with 100 already-retained programs was 2.83 microseconds/call for the Rust policy with batched handles versus 0.64 for the previous JS policy. The measured overhead is about 0.0022 milliseconds per render. This migration does not claim a GPU speedup; it avoids the much larger per-program boundary regression while preserving behavior.

Focused tests exercise retention boundaries/replacement/duplicates, exact visible meshes, transmission variants and cleanup, readiness timeout, idle cancellation/retry, hidden polling, and integrated book preparation. The browser/GPU integration run belongs to the parent release worktree.

Verification: isolated UI/shelf release compilation succeeded; 106/106 tests passed across `gpu-programs`, `gpu-program-policy-native`, `book-presentation-native`, `book-absent-bookmark-motion`, `bookshelf-scene-programs` and `native-model-upload-slices` (17.26 seconds).
