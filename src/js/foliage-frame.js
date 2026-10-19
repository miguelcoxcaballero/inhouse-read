// Only host object field access crosses this adapter. Pose comparisons, clip
// invalidation and exclusion geometry stay in the scene's retained Rust arena.
export function createFoliageFrame(rust) {
  const native = new rust.RustFoliageFrame(), memory = native.memory(), states = new Set();
  let count = -1, at = 0, buffer = null, input, disposed = false;
  function check() { if (disposed) throw new Error('Foliage frame has been disposed'); }
  function prepare(areas) {
    check();
    if (count !== areas.length) {
      count = areas.length; native.resize(count); at = native.input_ptr(); buffer = null;
    }
    if (buffer !== memory.buffer) { buffer = memory.buffer; input = new Float64Array(buffer, at, count * 4); }
    let index = 0;
    for (const area of areas) {
      input[index++] = area.left; input[index++] = area.right; input[index++] = area.top; input[index++] = area.bottom;
    }
    native.commit();
  }
  function createState() {
    check();
    const state = new rust.RustFoliageState(), pointer = state.input_ptr();
    let stateBuffer = null, values, model = null, released = false;
    function valid() { check(); if (released) throw new Error('Foliage state has been disposed'); }
    const handle = {
      pose(next, rotation, rect) {
        valid();
        if (stateBuffer !== memory.buffer) { stateBuffer = memory.buffer; values = new Float64Array(stateBuffer, pointer, 26); }
        values.set(next.matrix.elements);
        values[16] = rotation.x; values[17] = rotation.y; values[18] = rotation.z; values[19] = rotation.w;
        values[20] = rect.left; values[21] = rect.right; values[22] = rect.top; values[23] = rect.bottom;
        values[24] = rect.width; values[25] = rect.height;
        const moved = state.update_pose(model !== next);
        if (moved) model = next;
        return moved;
      },
      clip() { valid(); return state.clip(native); },
      free() {
        if (released) return;
        state.free(); released = true; model = values = stateBuffer = null; states.delete(handle);
      }
    };
    states.add(handle); return handle;
  }
  function free() {
    if (disposed) return;
    for (const state of states) state.free();
    native.free(); disposed = true; input = buffer = null;
  }
  return { prepare, createState, free };
}
