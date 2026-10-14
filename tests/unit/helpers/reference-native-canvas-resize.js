// Three assigns both canvas dimensions on a size change. Assigning an
// unchanged native dimension still resets the framebuffer.
// The other dimension must genuinely change and reset the whole buffer.
// Preserve the unchanged dimension
// while Three updates its own logical size, pixel ratio and viewport.
export function withNativeCanvasResize(renderer, operation, physical, { avoidIntermediateAllocation = false } = {}) {
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
  const originalHeight = descriptors[1].get.call(canvas);
  let stagedHeight = false;
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
          // Three writes width, then height. When both change, the first write
          // allocates new-width x OLD-height even though nobody renders it.
          // A zero-height staging buffer avoids that full intermediate
          // allocation; the normal height write creates the exact final frame.
          // Shrinking both axes already keeps the intermediate frame within
          // the existing allocation. Avoid an extra zero-size reset there;
          // native drivers may synchronously drain the displayed frame on it.
          // Bounded room growth also stays below its required final allocation;
          // skip the zero-height reset while preserving cross-axis staging.
          // This opt-in remains inside the synchronous sizing operation.
          if (avoidIntermediateAllocation && axis === 'width' &&
              value === physical.width && value !== descriptor.get.call(this) &&
              physical.height !== originalHeight && originalHeight > 0 &&
              !(physical.width < descriptor.get.call(this) && physical.height < originalHeight) &&
              !(avoidIntermediateAllocation === 'bounded' && physical.width > descriptor.get.call(this) && physical.height > originalHeight) &&
              descriptors[1].get.call(this) === originalHeight) {
            try { descriptors[1].set.call(this, 0); }
            catch { /* A driver rejecting staging keeps its original resize. */ }
            stagedHeight = descriptors[1].get.call(this) === 0;
          }
          descriptor.set.call(this, value);
          if (axis === 'height') stagedHeight = false;
        }
      });
      installed.push(axis);
    }
  } catch {
    for (const axis of installed) delete canvas[axis];
    return operation();
  }
  try { return operation(); }
  finally {
    for (const axis of installed) delete canvas[axis];
    // Preserve the original partial-operation dimensions when an operation
    // throws, or never reaches Three's second assignment. No zero-sized
    // presentation can survive this synchronous resize scope.
    if (stagedHeight && descriptors[1].get.call(canvas) === 0) descriptors[1].set.call(canvas, originalHeight);
  }
}
