# Book model quality and resource ownership in Rust

`rust-ui/src/book_model_policy.rs` owns the model's quality decisions and resource bookkeeping through the shelf module. `book-model.js` keeps Three constructors and rendering bindings.

- Overview, shelf, inspection and lifted-book texture resolutions, mesh segment counts, cover aspect rounding and pixel-ratio thresholds use the original formulas. No resolution or material quality is reduced.
- Shared procedural textures are retained by Rust. Each model receives its own Three texture clone with the same `Source`; the source version is restored after cloning to prevent redundant GPU uploads. Repeat/sampler state remains independent. A failing builder is retryable, and builders can reenter the cache.
- The model's geometry traversal, material/texture deduplication and disposal order run in Rust. Disposing one model does not dispose another model's texture clone or the cached source texture.
- Relief map adoption retains reused maps, releases replaced owned maps, and installs the shared material texture into all four finish slots. Asynchronous bake cancellation and image loader subscriptions retain their existing host lifecycle.
- Paper, cover and spine-cap finish rules run in Rust; Three receives the same property values and update flags in the original order, preserving lamp reflections.

The differential tests exercise real Three textures/materials, threshold combinations, Source versions, cache reentry/retry, aliased resource disposal, relief map replacement and finish parameters. Existing full model, page texture and relief tests exercise the integrated host. This change does not claim a measured battery or frame-rate improvement; it preserves the established upload deduplication while moving policy ownership to Rust.

Verification: the isolated release build of both UI and shelf modules passed. All 125 cases in `book-model-policy`, `book-model`, `book-shared-paper-texture`, `book-cover-relief` and `native-model-upload-slices` passed. The policy suite checks 1,568 quality/inspection combinations and 132 raster-size combinations against the original formulas. No GPU/browser or physical-device battery measurement was performed for this isolated block.
