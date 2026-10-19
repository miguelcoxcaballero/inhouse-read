# Supertonic numeric plans in Rust

The voice core now validates the model dimensions and denoising steps, plans latent frame counts and mark offsets, decodes UTF-16 tensor indices, filters per-chunk boundary marks, and owns PCM concatenation offsets and Gaussian sample arithmetic. ONNX sessions/tensors, model JSON indexer lookup, browser randomness and engine Math.log/Math.cos remain host bindings. The transcendental bindings preserve exact existing Float32 output instead of changing the acoustic input. The six-step quality profile, complete predicted duration and pitch-preserving tempo processing are unchanged.

Gaussian scratch is bounded to 256 samples (5,120 bytes) rather than allocating a second full latent. A typed view is refreshed after an injected RNG grows WASM memory. PCM gap buffers are eliminated: a native join plan places each host-owned PCM chunk into the final zero-initialized buffer, with the same 150 ms gaps and timeline offsets. Its handle and all temporary arenas are released on errors and cancellation.

Validation: 37 tests across five suites passed, including the existing inference/cancellation lifecycle, UTF-16/lone-surrogate tensor indices, exact seeded Gaussian samples across block boundaries, extreme uniforms and memory growth, numeric-only marks, strict configuration validation, zero-length PCM chunks and 500 repeated jobs with bounded memory. No real-model speed or mobile battery improvement is claimed from these tests.

A complete-bridge synthetic benchmark under concurrent integration load measured approximately 0.22/0.30 ms for JavaScript/native at 4,096 samples and 6.37/7.47 ms at 65,536 samples (medians, seeded host RNG). This block is a functional migration and removes PCM-gap allocations; it is not a Gaussian speedup. It retains the engine math bindings for exact quality. Logs: `/workspace/scratch/supertonic-numeric-{regression,benchmark-optimized}.log`.

Runtime session ownership, initialization and inference sequencing are a separate remaining migration block; this document does not mark the whole runtime as migrated.

## Runtime admission and ownership follow-up

The initialized runtime now also uses a native session state for serial-job admission, strict rate validation, cancellation/close state and generation-aware completion. The host retains the active Promise only to await inference before releasing ONNX resources; it no longer independently decides whether the runtime is disposed or busy. Native shape/data validation precedes constructing style tensors. Close and native-handle release are idempotent, and cleanup remains in `finally` even if a session release fails.

36 tests across four suites pass, including stale completion during a newer job, close while running, double disposal, invalid options, existing ONNX cancellation/disposal and style tensor constraints. Log: `/workspace/scratch/supertonic-state-regression.log`. The asynchronous ONNX invocation sequence itself remains a host binding around the native text/audio planners; further extraction must preserve checkpoint order and tensor ownership.
