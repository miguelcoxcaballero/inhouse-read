// Three assigns both canvas dimensions on a size change. Assigning an
// unchanged native dimension still resets the framebuffer.
// The other dimension must genuinely change and reset the whole buffer.
// Preserve the unchanged dimension
// while Three updates its own logical size, pixel ratio and viewport.
export function withNativeCanvasResize(renderer, operation, physical) {
  const canvas = renderer?.domElement;
  if (!renderer?.isWebGLRenderer || renderer.autoClear !== true || renderer.autoClearColor !== true ||
      renderer.autoClearDepth !== true || renderer.autoClearStencil !== true ||
      renderer.xr?.isPresenting || renderer.getRenderTarget?.() || renderer.getScissorTest?.() !== false ||
      typeof HTMLCanvasElement === 'undefined' || !(canvas instanceof HTMLCanvasElement) ||
      !Number.isInteger(physical?.width) || physical.width <= 0 ||
      !Number.isInteger(physical?.height) || physical.height <= 0 ||
      (physical.width === canvas.width && physical.height === canvas.height) ||
      !Object.isExtensible(canvas) || Object.hasOwn(canvas, 'width') || Object.hasOwn(canvas, 'height')) return operation();
  const prototype = HTMLCanvasElement.prototype;
  const descriptors = ['width', 'height'].map(axis => Object.getOwnPropertyDescriptor(prototype, axis));
  if (descriptors.some(value => !value?.get || !value?.set || !value.configurable)) return operation();
  const installed = [];
  try {
    for (let i = 0; i < descriptors.length; i++) {
      const axis = ['width', 'height'][i], descriptor = descriptors[i];
      Object.defineProperty(canvas, axis, {
        configurable:true, enumerable:descriptor.enumerable,
        get() { return descriptor.get.call(this); },
        set(value) {
          // Only Three's already-normalised integer assignment can be omitted.
          // Preserve WebIDL coercion for every other value.
          if (Number.isInteger(value) && value >= 0 && value === descriptor.get.call(this)) return;
          descriptor.set.call(this, value);
        }
      });
      installed.push(axis);
    }
  } catch {
    for (const axis of installed) delete canvas[axis];
    return operation();
  }
  try { return operation(); }
  finally { for (const axis of installed) delete canvas[axis]; }
}
