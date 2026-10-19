# Native runtime migration — 1.7.308

This batch moves coherent own application policy into Rust while retaining browser, Three, IndexedDB and ONNX handles in host adapters. It does not change language accounting or claim the whole migration is finished.

Included: batched physical pose transfer; plant record normalization and shelf bake-cache ownership; furniture defaults; catalog camera and preview lifetime; foliage projection arenas; GPU program retention/readiness; book-image leases and paper-tone sampling; lamp material/power/tint recipes; cover-relief portable policy; shared record normalization; outgoing/receiving live transport; app room-capture coordination; and shared natural-voice client generation/receipt state.

The native pose/foliage paths retain matrices, order of writes, quaternion/Euler conventions and ownership rules. Live transport preserves encrypted mailbox/RTC protocols, stable identity and stale-completion cancellation. Image buffers, GPU programs and decoded resources retain host ownership. Natural voice is still loaded only on explicit voice use, with no activation caused by opening or pausing a reader.

## Validation

- All 147 targeted cases passed across 19 changed suites, followed by the complete unit inventory: 7,348 cases across 569 files Initial 37 failures were 31 incomplete app mocks, two renderer fixtures needing the real shelf after module reset, and four monolithic stress watchdogs. All 103 cases in the five renderer/stress suites and all 31 app cases pass after fixture repair and bounded batching; all original seeded cases, comparisons and aggregate coverage assertions are retained.
- Four combined browser checks passed: both PDF/EPUB reader power/return cases and both compiled IKEA catalog cases, including delayed module download. During the eight-second reader interval: zero RAF, GL draws or worker messages; main-thread work about 46/58 ms under concurrent build load.
- Both live-room stability browser cases passed in an isolated retry: exact room poses/paint across mobile and desktop, held drag, lamp setting, resize/reload; and encrypted Drive-held movement with RTC deliberately blocked. The test-only loopback TCP TURN fixture is needed for managed Chromium's UDP policy; it does not change production relay configuration.
- Initial browser failures are retained in the logs: the RTC run omitted the necessary TURN fixture (zero ICE candidates), and the relay run had a 15.84-second blocked boundingBox call under concurrent builds. Both original assertions passed unchanged in the isolated run.
- Production Vite/offline shell and canonical updater verification pass. No APK/catalog/channel or shared updater copy was modified.

Source and detailed benchmark limits are documented in the individual policy/bridge notes. Some cold-path adapters add a few microseconds; this release does not infer global FPS, battery gains or complete migration from kernel benchmarks.

Logs: `/workspace/scratch/native-runtime-308-{targeted,full-unit,browser,live-quiet,stress-retry,vite}.log`; full unit JSON has the same prefix.
