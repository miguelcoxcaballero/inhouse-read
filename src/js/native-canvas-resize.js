import { needRustShelf } from './rust-shelf.js';

// Three assigns both canvas dimensions on a size change. Assigning an unchanged native
// dimension still resets the framebuffer, so the unchanged dimension is skipped while Three
// updates its own logical size, pixel ratio and viewport, and a zero-height staging write
// avoids the full intermediate allocation when both change. The scope, its staging rules and
// its restoration run in Rust (rust-ui/src/native_resize.rs, the shelf module).
export function withNativeCanvasResize(renderer, operation, physical, options) {
  return needRustShelf().with_native_canvas_resize(renderer, operation, physical, options);
}
