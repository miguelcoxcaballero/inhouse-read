# Shelf startup — 1.7.302

Returning launches now show a validated local PNG of the last settled shelf while the 3D engine initializes. An independent small module reads it alongside the existing early IndexedDB library read. Vite must emit this as a separate entry: combining HTML module scripts into main would put the preview behind main's mandatory WASM dependencies again.

The PNG is only a first paint, never an authority for layout, hit testing or physics. Its key includes the build, viewport/DPR/native inset, actual theme, account, visual book metadata (excluding cloud acknowledgements), SHA-256 of cover bytes, and all shelf settings including canonical physical poses and lamp state. Any mismatch rejects it. The image has no pointer handlers and is removed on the first actual scene frame, resize, storage changes or page exit. The live scene still waits for the actual fonts and photographs; no fallback lettering is painted first.

Snapshots are taken from the already resolved native framebuffer after a one-second quiet period and an idle slice. Moving/selected books, pending quality, readers, scrolled or zoomed views, hidden pages and oversized outputs are excluded. Saving rechecks both render generation and persisted state. There is one latest PNG, bounded at 6 MiB and four million pixels; no image resampling or reduced scene settings. Storage/codec failures leave the normal startup path working.

Cold cover analysis now submits one bounded family of at most 24 glyph masks per worker message, rather than awaiting a reply for every mask. It keeps the same glyphs, font candidates, scoring order and Rust numerical scorer. A failed worker retains the original sliced fallback. Batch responses validate length and every finite score.

Validation:

- 86 unit cases across 11 suites: startup/cache invalidation, cover/font first paint, worker transport and original/Rust scorer parity.
- Production Chromium tests: web and Android-shell user-agent warm launch with mandatory WASM deliberately held; exact cached PNG bytes and subsequent book interaction; changed-light cache rejection; delayed real WOFF2/photo readiness and opening the PDF.
- Build, offline manifest and shared updater verification.

Local production-build warm-launch measurements were 240 ms on the web user agent and 231 ms on the Android-shell user agent (390 × 844 CSS pixels). This measures the first shelf image, not 3D readiness. Chromium uses software WebGL here; its shader timings cannot be presented as physical-phone timings. An empty cache, changed state or first installation still needs full initialization. Android testing exercises the shared web code under the shell user agent, not a physical Android device or a new APK release.
