// The rigid-body solver knows the scene's entries by key. The keys are registered once per
// layout (never per frame); the entries' numbers live in the scene's own arena
// (scene-entry-frame.js), which the solver steps in place (rust-ui/src/book_gravity_frame.rs).
export function createGravityFrame(rust) {
  const native = new rust.RustGravityFrame();
  let entries = null, disposed = false;
  function prepare(next) {
    if (disposed) throw new Error('Gravity frame has been disposed');
    // Shelf layouts replace their entry array, including same-length reorders.
    if (entries === next) return;
    native.register(next.map(entry => entry.key)); entries = next;
  }
  function free() {
    if (disposed) return;
    native.free(); disposed = true; entries = null;
  }
  return { native, prepare, free };
}
