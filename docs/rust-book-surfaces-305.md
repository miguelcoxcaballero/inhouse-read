# Rust book texture streams — 1.7.305

Book texture seeds, lattice noise and random sequences now run in Rust. The browser callback retains only an owned batch cursor (64 values); cloth planning resumes the exact consumed state. Arbitrary random callbacks and unusual cloth widths run the original painter in Rust. The JavaScript weave raster duplicate is removed.

ImageData generation previously crossed into JavaScript four times for every pixel. Real typed ImageData now receives a single bulk pixel copy. Owned seeded fields also generate their complete stream inside Rust, with no callback per pixel. Canvas errors preserve both the original thrown value and the already-consumed random cursor.

Validation:
- 150 cases across seven suites passed, including exact Canvas commands/pixels for 1,500 randomized spines, random-state boundaries, Unicode seeds, all surface bytes, failed allocations, memory growth, and book-model behavior.
- Two Chromium WebGL cases passed: complete real texture/binding integration and reflections under window/warm lamp lighting. Diffuse print, silhouettes and repeated quality/seed results are unchanged; resources remain bounded.
- `scripts/benchmark-spine-field.mjs` compares the preceding compiled module against this one. Eight byte-identical synthetic ImageData cases: seeded field generation 4.18–12.96x faster (default 6.02x); arbitrary callback field 2.79–4.09x. These are isolated Node generation/interop measurements, not whole-app FPS or physical Android battery results.
- Production build and shared updater verification passed; no APK or updater catalog publication.

Same inventory: 36,642 Rust / 21,033 JavaScript production nonblank lines, 63.53%. This does not mean 63.53% functional migration; substantial own orchestration and browser/Three.js adapters remain.
