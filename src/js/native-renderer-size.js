// Apply a native framebuffer size and DPR together when both change.
// Three's setPixelRatio otherwise resizes the OLD logical size first.
// The installed atomic API retains the same floor, viewport and CSS policy.
export function configureNativeRendererSize(renderer, width, height, ratio, scratch, native = true) {
  if (native) {
    const ratioChanged = renderer.getPixelRatio() !== ratio;
    renderer.getSize(scratch);
    if (ratioChanged && (scratch.x !== width || scratch.y !== height) &&
      typeof renderer.setDrawingBufferSize === 'function' && !renderer.xr?.isPresenting) {
      renderer.setDrawingBufferSize(width, height, ratio);
      return;
    }
  }
  // Legacy, XR, older renderers, and one-field changes keep their original
  // ordering. In particular setSize's XR guard is not bypassed.
  if (renderer.getPixelRatio() !== ratio) renderer.setPixelRatio(ratio);
  renderer.getSize(scratch);
  if (scratch.x !== width || scratch.y !== height) renderer.setSize(width, height, false);
}
