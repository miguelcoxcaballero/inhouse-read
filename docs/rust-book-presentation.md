# Rust book preparation lifecycle

`book_presentation.rs` owns idle preparation of borrowed shelf models and temporary detailed models: validation, per-renderer deduplication, cancellation after idle/cover loading, retry after failed or cancelled preparation, program retention and temporary-model disposal. Three constructs the unchanged camera/lighting rig and compiles the original meshes/materials. No shader source or visual quality setting changes.

Promise stages are bound JavaScript callbacks into Rust exports. Their state is a garbage-collectable JavaScript object, rather than a Rust future retaining a model while a browser decoder or idle signal remains unresolved. A WeakMap retains each renderer's preparation; failed/cancelled tasks remove only their own entry. Detail models release through `finally`, including decoder, compiler, uniform and disposal failures.

Tests cover the integrated real model paths with a renderer double, plus simultaneous callers, rejected image readiness, disposal failure and initial idle rejection. GPU/device performance is not measured by these isolated tests.

Verification: isolated UI/shelf release compilation passed. All 82 cases passed in `book-presentation-native`, `book-absent-bookmark-motion`, `bookshelf-scene-programs` and `native-model-upload-slices`.
