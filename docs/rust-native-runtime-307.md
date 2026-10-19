# Native runtime batching — 1.7.307

This release integrates native persistent physics frames and IDs, scoped relief render buffers, plant surface queues and appearance lifecycle, book texture/presentation ownership, lamp pool/shadow state, framebuffer/cover cache policy, and title-font request/wrapping/selection policy. Browser/Three/WebGL/Canvas APIs and GPU shaders remain host operations. Geometry, pixels, quality/resolution profiles, saved positions and physics equations are preserved.

Measured isolated improvements (not application FPS or physical-device battery measurements):
- Physics bridge plus unchanged solver: initial quiet measurements 1.25–1.44×, with exact outputs. Repeated measurements varied under parallel compilation.
- Relief pipeline: 1.03–1.68× in measured bakes; 512² normal/RGBA WASM memory 7,012,352 → 3,538,944 bytes, stable after repeated operations.
- Lamp manager: about 21–22% less CPU over 5,000 eight-lamp updates. More than 5 million light facts matched the previous implementation across unit/browser comparisons.
- Title wrapping: 26,400 → 8,800 Canvas measurements for 100 families; interleaved browser median 22.8 → 17.2 ms. Uncached native wrapping is slower; production uses bounded per-family reuse.
- Framebuffer cache arithmetic is essentially neutral in its isolated benchmark; no GPU improvement is claimed for moving those rules.

Validation and original failures are retained in the session reports:
- Broad run: 554 unit files, 7,132 cases; 7,116 passed initially, 16 failed. Failures were outdated independent scene/gesture references (missing already-published 299/303 contracts), the physics test spying on the replaced API, a close fixture with unversioned word counts, hidden context restoration expectations, and long CPU stress cases exceeding their existing 5 s watchdog under parallel builds.
- Updated references retain their independent JavaScript mathematics. The 306 baseline reproduced the original scene differences; all four complete baseline/new transcripts match. No product behavior was changed to recover older hidden rendering or capture behavior.
- All affected behavior was rerun. The 12-suite retry passed 128/130, with only two stress-test watchdog failures left. Those two tests were split into bounded event/trial cases without removing PCM comparisons, changing the seeded 20,000-case corpus, weakening assertions or extending the watchdog; all 105 resulting cases passed. Reader location similarly preserves its 200 trials in bounded batches.
- Added plant conversion hardening ensures thrown JavaScript string conversions propagate through Result and release native handles. Targeted parity/lifetime tests passed with the final compiled module.
- Seven combined Chromium cases passed: reflections, actual stored font appearance, real worker and main-thread-only font matching, PDF/EPUB reader idle ownership, and actual relief/strength/cancellation. Reader idle: zero RAF, WebGL draws or worker messages in both formats.
- Final production build and shared updater verification passed. Three further final-browser cases passed: stored production glyph appearance, full book surface/binding integration and 695,718 exact real-Three light facts with zero unexpected differences or retained native handles. No APK/catalog publication.

Pre-existing native-return timing limitation: two isolated SwiftShader scenarios exceed their unchanged 8 s observer budget. The same aligned scenario fails on 1.7.306 (12.59 s); candidate measurements were 8.97/10.52 s. These timings are not claimed as passing or as an application speedup. Completed traces preserve framebuffer geometry and report no page errors; assertions after the timing failure were not counted as executed.

Full functional migration remains pending. See rust-migration-boundary-audit.md; this release does not claim completion. User-facing language progress is exclusively GitHub's language statistic, queried after publication; no alternate percentage or Linguist configuration change was used.
