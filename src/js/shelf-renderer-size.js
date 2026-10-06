import { configureNativeRendererSize } from './native-renderer-size.js';

// The shelf's shared Three renderer owns a native GL framebuffer even when
// its final image is copied into a 2D canvas. Change DPR and size together,
// avoiding full intermediate buffers. Presentation and viewport rounding
// remain the caller's existing policy for native and copied shelf images.
export function configureShelfRendererSize(renderer, width, height, ratio, scratch) {
  configureNativeRendererSize(renderer, width, height, ratio, scratch, true, true, true);
}
