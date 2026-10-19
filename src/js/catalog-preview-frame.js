import { needRustShelf } from './rust-shelf.js';

/** Three/WebGL binding for the native retained camera and buffer-size policy. */
export function createCatalogPreviewFrame() {
  const frame = new (needRustShelf().CatalogPreviewFrame)();
  return {
    apply(camera,renderer,rect,size,padding) {
      const next = frame.update(rect.width,rect.height,size.x,size.y,padding);
      if (!next) return;
      camera.left = next[2]; camera.right = next[3]; camera.top = next[4]; camera.bottom = next[5];
      camera.updateProjectionMatrix();
      if (next[6]) renderer.setSize(next[0],next[1],false);
    },
    dispose:() => frame.free()
  };
}
