// Every entry's motion sample, pose matrix, room matrix and projection in one native call per
// frame (rust-ui/src/scene_entry_frame.rs). The host writes the poses and projection inputs
// into the retained arena and reads the results from it; views follow any growth of memory.
export const ENTRY_INPUT = 22, ENTRY_OUTPUT = 70;
export function createSceneEntryFrame(rust) {
  const native = new rust.RustSceneEntryFrame(), memory = native.memory(), roomAt = native.room_ptr();
  let count = -1, inputAt = 0, outputAt = 0, buffer = null, room = null, disposed = false;
  const frame = { input:null, output:null, prepare, step, free };
  function refresh() {
    if (disposed) throw new Error('Scene entry frame has been disposed');
    if (buffer === memory.buffer) return;
    buffer = memory.buffer; room = new Float64Array(buffer, roomAt, 16);
    frame.input = new Float64Array(buffer, inputAt, count * ENTRY_INPUT);
    frame.output = new Float64Array(buffer, outputAt, count * ENTRY_OUTPUT);
  }
  function prepare(length) {
    if (disposed) throw new Error('Scene entry frame has been disposed');
    if (count !== length) { count = length; native.resize(count); inputAt = native.input_ptr(); outputAt = native.output_ptr(); buffer = null; }
    refresh();
  }
  function step(motionFrame, scene, motion, transition, now, arranging, roomMatrix) {
    refresh(); room.set(roomMatrix.elements);
    native.step(motionFrame, scene, motion, transition, now, arranging); refresh();
  }
  function free() {
    if (disposed) return;
    native.free(); disposed = true; buffer = room = frame.input = frame.output = null;
  }
  return frame;
}
