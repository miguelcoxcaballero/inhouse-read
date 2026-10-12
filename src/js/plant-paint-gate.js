/** Full-resolution paint can wait for the shelf's first frame: its exact
 * coarse textures already exist. Never hold a standalone preview or wait
 * indefinitely for a WebGL surface that cannot present. */
export function createPlantPaintGate({
  scene = () => globalThis.document?.querySelector?.('canvas.ihr-bookshelf-scene'),
  now = () => performance.now(), maxWaitMs = 1000
} = {}) {
  let waiting = null, started = 0;
  return () => {
    const canvas = scene();
    if (!canvas?.isConnected || Number(canvas.dataset.renderCount) > 0) {
      waiting = null;
      return false;
    }
    if (waiting !== canvas) { waiting = canvas; started = now(); }
    return now() - started < maxWaitMs;
  };
}
