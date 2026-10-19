# Native runtime migration — 1.7.309

This batch continues the functional migration without changing language accounting or claiming completion. Rust now owns decoration geometry/placement recipes and plant sizing/pick rules; retained scene motion/checkpoint and projection/style state; live RTC negotiation, channels, health, publication, BroadcastChannel and session/timer lifecycle; catalogue presentation/flight state; book-view animation and framebuffer-reservation ownership; idle startup scheduling; deployed-shell reload policy; Supertonic numeric/runtime admission and PCM join plans; natural-voice worker/facade jobs; and phonemizer rebuild/dictionary lifecycle.

Browser/Three/ONNX/IndexedDB handles and Promise/event/timer execution remain host bindings. Cold bootstrap remains only where the native module cannot yet exist, without forcing reader or voice loading. GPU shader source and all model/texture quality remain unchanged. Host Math.log/Math.cos preserve exact Supertonic Float32 input, and full-duration inference/six denoising steps are retained.

Validation:

- 288 targeted cases passed across 22 suites. The affected regression inventory then passed **4,209/4,209 cases across 317 files**.
- Both real mobile/desktop live-room cases passed: strict saved/rendered pose equality, held drag, lamp state, resize/reload, and encrypted Drive transport with RTC blocked. The managed browser uses the existing test-only loopback TCP TURN fixture; production configuration is unchanged.
- Both reader power/return cases passed. PDF and EPUB reading produced zero RAF, GL draws or worker messages in the eight-second observation; PDF main-thread work was about 91 ms under build load. This is an idle-work check, not a device battery benchmark.
- Both compiled IKEA catalogue cases passed, including an intentionally pending module download, with all selection assertions retained.
- The live rendered-pose probe was updated because its former inline arithmetic moved into Rust. It still observes the actual pose immediately before matrix update, not the checkpoint, and now fails explicitly if instrumentation is missing. Four new probe tests cover distinct real/checkpoint poses and old/new minified bundles. Catalogue ABI spies now observe the grouped public dialog/presentation entry points instead of internal drawing calls.
- The real espeak fixture passed: 161 calls in three languages, five heaps, exact phonemes and offline rebuilds without new requests. No model download was added.
- Combined Rust core/UI/shelf, Vite/offline shell and canonical updater verification pass. No APK, release channel/catalog or shared updater file was changed.

Individual documents retain exact benchmark scope and overhead: persistent scene bridges reduce copy/packing work; some cold-path adapters add microseconds and the Gaussian bridge is not a speedup. This release does not claim global FPS gains, a new functional percentage, or completion of the remaining migration.

Evidence: `/workspace/scratch/native-runtime-309-{targeted,regression,browser,catalog-retry,live-retry,probe-test,vite}.log`, with regression JSON alongside. Initial browser failures were obsolete test hooks; the repaired hooks retain the original counts, values and tolerances.
