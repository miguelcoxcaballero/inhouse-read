import { needRustShelf } from './rust-shelf.js';

// Apply a native framebuffer size and DPR together when both change.
// Three's setPixelRatio otherwise resizes the OLD logical size first.
// The installed atomic API retains the same floor, viewport and CSS policy.
// The ordering rules run in Rust (rust-ui/src/native_resize.rs, the shelf module).
export function configureNativeRendererSize(renderer, width, height, ratio, scratch, native = true, preserveUnchangedDimensions = false, avoidIntermediateAllocation = false) {
  needRustShelf().configure_native_renderer_size(renderer, width, height, ratio, scratch, native, preserveUnchangedDimensions, avoidIntermediateAllocation);
}
