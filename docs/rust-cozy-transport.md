# Shelf sound transport ownership

`cozy_transport.rs` governs admission of short shelf cues, audio-device ownership,
trusted-gesture unlocking, the first silent iOS sample, mute and visibility,
resume failures, four simultaneous voices and their fading tails, and closing
the device after its final shelf owner leaves. It also owns the 180 ms idle
suspension and event deadline, 550 ms view-whoosh exclusion, variant sequence,
strength levels, gain and pan clamps, listener registration and idempotent disposal.
Drag events 4, 8, 11 and 18 stay silent without consuming a variant.

The host passes browser WebAudio, DOM and promise objects. Callback factories are
small JavaScript adapters into the native transitions. State and callback cycles
are owned by JavaScript's garbage collector; the Rust module retains no closures,
JavaScript handles or timer callbacks between calls. An active audio device is
never needed for a settings panel or an untouched shelf. The settings preference
still loads before the shelf module without forcing its startup.

Recorded atlas fetching, index validation, route/take selection, decoded-buffer
caching and PCM conversion are a separate, unchanged host port in this block.
They are remaining application policy, not claimed as unavoidable host APIs.
The existing native clip and fallback synthesis policies, recordings, sample
rates, sound design and contact events are unchanged.

The compiled module is checked against the frozen preceding transport through
32 differential scenarios. The traces compare WebAudio allocation and call order,
gain/pan/rate values, PCM bytes, source start/stop/fade times, timer scheduling and
cancellation, listener flags and removal, exact deadline boundaries, trusted and
untrusted gestures, muted/hidden states, multiple owners, context replacement,
delayed/rejected resume, synchronous coercion side effects and failures, and missing browser
features. Another case runs 160 full shelf lifetimes with seven voices each,
including tails, proving that native handles and scheduled native callbacks
return to baseline. The original 13 transport tests are retained with the real
native controller and controlled PCM/clip ports. The unchanged synthesis and
gravity-contact suites are also run against the built Shelf WebAssembly module.
Together these four suites pass 132 cases, using main's existing per-event PCM
fixture (`5ddcada7`) without changing or dropping its comparisons.

A warmed Node microbenchmark alternated nine samples against the preceding
transport, using stub WebAudio nodes and cached short PCM. A play/end cycle costs
0.89 → 36.37 microseconds (1,000 cycles per sample). The frame-loop enabled query
costs 0.014 → 2.38 microseconds (100,000 calls per sample). Thus this ownership
migration adds about 35.5 microseconds per cue and 2.37 microseconds per status
query on that host. It is not a speed improvement. Real audio devices, frame
rate, battery usage and mobile performance are not measured by this benchmark.
