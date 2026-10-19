# Cabinet policy in Rust

`shelf_furniture_policy.rs` owns cabinet scale normalization, row normalization, shared-material fallback and batching, object metadata and idempotent geometry disposal. It also normalizes contact-shadow dimensions and footprints to the same reference scale, then applies the final scale and refreshes bounds.

The numerical cabinet and contact-shadow kernels remain unchanged. JavaScript retains the Three constructors and the numeric core's typed-buffer ABI bridge: it copies vertex attributes out before freeing the core allocation. The original geometry, material identity, draw-call grouping, board bounds, physical texture scale and shadow bytes are preserved.

The frozen immediately preceding implementation is exercised over valid, missing and malformed dimensions, duplicate rows, multiple physical scales and all material-sharing combinations. Checks compare every geometry attribute byte, bounds/spheres, metadata and material identity. Additional cases cover conversion failures, native handle release, and reentrant disposal that leaves shared materials alive. This does not change the render loop or claim a GPU performance improvement.
