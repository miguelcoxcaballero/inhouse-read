# Natural-voice client runtime state

The web `SynthClient` and Android `NativeSynthClient` use the same small ledger
in `rust-core/src/voice_client.rs`, compiled only into the voice domain. Rust
owns generation/sequence numbers, registered calls and synthesis jobs, message
admission and one-shot settlement, cancellation, diagnostic validation, active
model identity, pending preparation identity and Piper/Supertonic replacement
and cache-hit decisions. No PCM, acoustic model or ONNX tensor is copied into
this ledger. The complete isolated voice WASM is 65,472 bytes in this build.

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
