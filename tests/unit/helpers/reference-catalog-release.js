// Amendment to the frozen catalogue studios (helpers/reference-*-catalog-preview.js, reference-catalog-studio.js):
// a deliberate behaviour change. A studio closed for RELEASE_MS shrinks its frame-sized drawing buffer to one pixel
// and lets its key light's shadow map go (rust-ui/src/catalog_studio.rs: studio_release_idle, studio_three_shrink);
// reopening a released studio draws in the same task, so no frame shows the shrunk buffer.
export const RELEASE_MS = 8000;

/** Shrink `renderer`'s drawing buffer and drop `key`'s shadow map. Whether it shrank. */
export function shrinkStudio(renderer, framing, key) {
  if (!renderer) return false;
  const canvas = renderer.domElement;
  if (canvas.width * canvas.height <= 4) return false;
  framing.forget();
  renderer.setSize(1, 1, false);
  const shadow = key?.shadow, map = shadow?.map;
  if (map !== undefined && map !== null) { map.dispose(); shadow.map = null; renderer.shadowMap.needsUpdate = true; }
  return true;
}
