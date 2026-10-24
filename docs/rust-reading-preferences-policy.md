# Reader preferences after native readiness

`reading_preferences_policy.rs` normalizes reader selectors, validates saved
voice/language choices against the existing catalogue, applies boolean flags,
formats rate labels and owns the bounded FIFO CSS cache. The app-core ABI and
the UI/Shelf policy share `rust-core/src/reader_preference_rules.rs`: nearest
rates, numeric defaults/clamps and the CSS template have one Rust source.

The existing `rustReadingNumbers` function remains the eight-value app-core
memory adapter. Its caught allocation/coercion failures and release in `finally`
are preserved, including property access order before a fallback. Native fallback
values reuse the shared rules. CSS strings on the ready path are returned and
retained directly as JS strings, avoiding a separate app-core output arena and
UTF-8 decode. Each module's cache is bounded at 64 entries and includes all
rendered fields; browser code owns the WeakMap/Map storage without deciding
eviction or cache keys.

`reading-preferences.js` only observes `getRustUI()`/`getRustShelf()` and adopts an
already loaded policy. It never loads either module. Preference reads are also
available to the lazy reader stand-in before the reader is constructed, so the
original synchronous bootstrap path is retained when neither policy exists.
That path still uses the app core if it is already available. Actual reader
construction waits for `requireRustUI()` in its existing loader, so normal reader
operations use the native policy. There is no extra startup await, timer, voice
warm-up or model download.

Catalogue contents/language-tag adapters and cloud reading-state normalization
are unchanged. Tests cover the UI and Shelf builds, all theme/font/alignment
combinations, fractional typography, malformed preferences, custom property
keys, FIFO eviction, cold/rejected app-core adapters, exact errors and stable
native handle counts. Existing reader experience, preference flow, neural menus
and lazy-reader suites verify their actual integration.
