# Natural-voice client runtime state

The web `SynthClient` and Android `NativeSynthClient` use the same small ledger
in `rust-core/src/voice_client.rs`, compiled only into the voice domain. Rust
owns generation/sequence numbers, registered calls and synthesis jobs, message
admission and one-shot settlement, cancellation, diagnostic validation, active
model identity, pending preparation identity and Piper/Supertonic replacement
and cache-hit decisions. No PCM, acoustic model or ONNX tensor is copied into
this ledger. The complete isolated voice WASM is 73,329 bytes in this build.

`client-plan.js` owns the native allocation and host handle adaptation. Disposal
resets the Rust generation, retains its sequence/generation snapshot and frees
the allocation immediately. Reuse creates a fresh ledger from that snapshot;
late callbacks retain an invalidated bootstrap ticket. A finalization fallback
also releases abandoned controllers where the browser supports it. Scratch key
views are rebuilt after WASM allocations so memory growth cannot detach a view
that will later be used.

Preparation loads this core lazily. Constructing, inspecting or disposing a
client does not fetch it, create a Worker or start audio. The worker still loads
its own small voice core; it never imports the reader UI. The shared browser
loader/cache serves the same WASM asset to the page and worker, with independent
state/memory. A cancelled first download cannot install a controller or spawn an
orphan worker after disposal. There is no inference restart or replacement PCM.

The necessary host boundary retains Worker/native ONNX calls, transferred model
buffers, tensor objects, callback/promise registries, Promise execution order
and resource disposal. Before any optional WASM exists, the host keeps only the
bootstrap promise identity and release ticket. An invalid native `synth()` call
made before `prepare()` retains its original synchronous ID and asynchronous
`No voice loaded` error without fetching WASM; its bootstrap ID is adopted by
the first Rust ledger. This small pre-readiness path is explicit, not counted as
migrated application state.

Native runtimes and Hebrew phonemizers created after disposal are released
before they can overwrite a reconnected session. Running inference retains its
own session handles until output/feeds have been released, even if the public
client has already been disposed.

Validation includes existing engine/client, worker, prefetch and lifetime
regressions; 4,000 differential receipts; malformed/passive diagnostics; late
messages and cancellation; family replacement; cold-core failure and release;
late Supertonic/Hebrew creation; reused native handles; and stable native memory
capacity after 400 create/job/free cycles. Native tests retain the original
Piper feeds and genuine PCM processing. No physical-device latency/battery or
subjective audio-quality claim follows from these CPU tests.

The worker and public lazy facade now use this same ledger, with independent
allocations. Rust owns the worker FIFO, current job, drain state, exact command
decoding, numeric request admission, duplicate suppression, cancellation and
runtime/phonemizer selection. Worker message objects and callback closures remain
host handles; model buffers still transfer directly to ONNX. An active or still
queued ID cannot trigger a second inference, including a cancelled ID whose
original slot has not drained. Signed zero follows JavaScript Map/Set identity;
string IDs cannot cancel numeric requests.

Initialization still loads ORT, the phonemizer and voice WASM in parallel. Rust
generations reject initialization completed after release, and the host destroys
late phonemizers even when another initializer failed first. Serialized host
promises retain safe model release after active inference and in-progress model
creation. Cancellation is checked immediately after phonemization and inference,
before constructing silence or cleaning/copying unwanted PCM.

The facade imports its planner only on explicit `preload()`/playback, alongside
the engine module; this loads the small voice core, not a Worker or an acoustic
model. Before that point its host bootstrap callback list and release identity
are necessary to retain lazy behavior. Once ready, Rust adopts queued callbacks
and cancels the remaining batch when a callback closes, stops or pauses playback.
A reader closed during the first core download cannot warm up a voice afterward,
nor does it cause another download. Passive construction, pause, stop, release
and reader access do not start the core, Worker, model or audio pipeline.

Worker/facade regression coverage includes init failure/retry, late initializers,
cancelled ornaments, strict IDs and duplicate requests, release after late model
creation, stop/pause during callback adoption, and cold bootstrap invalidation.
These tests execute the actual voice-domain WASM with host ONNX/model fixtures;
they do not replace the real-model voice quality checks or device profiling.

## Phonemizer heap lifetime

`phonemizer_runtime.rs` owns the espeak heap call budget, rebuild decisions,
one-retry allowance, generation validity, and downloaded/installed dictionary
state. The measured production rebuild budget remains forty calls. The exact
espeak binary, immutable code/data cache, JSON command arguments and phoneme IDs
are unchanged. Raw bytes and Emscripten FS objects remain browser-owned handles;
Rust receives dictionary handle indices, not copies of multi-megabyte files.

Only explicit `createPhonemizer()` loads this small core, in parallel with its
factory import. Host promises serialize callers so two concurrent fragments
cannot rebuild or write over the same heap. A fresh heap reuses retained verified
dictionary bytes. Replacing or destroying a heap terminates its threads and drops
the old module; destroy immediately frees the Rust allocation and dictionary
handles. Pending production dictionary requests are aborted. Even a custom fetch
or factory that ignores cancellation cannot install bytes or a late module after
destroy; late factory output is terminated, and obsolete print callbacks are
ignored by generation. No new speech inference is started by these changes.

The remaining host code adapts imports, Emscripten callbacks/FS, JSON, Fetch,
AbortController and promise execution. The synchronous public language-name
helper retains its existing table and normalization before optional WASM exists;
moving that table would not itself migrate a functional subsystem.

Differential validation covers 7,200 rebuild/retry decisions including fractional
and non-finite thresholds, plus 240 complete fragment calls against a frozen
pre-migration reference (exact IDs, arguments, downloads, writes and rebuilds).
Native capacity is stable across 600 create/use/free lifetimes. Concurrency,
destroy during rebuild/download, stale callbacks and production fetch abort are
covered independently. Browser fixtures retain real espeak, repeated heap
replacement, exact phoneme equality and offline network assertions.
