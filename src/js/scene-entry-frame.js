// Every entry's motion sample, pose matrix, room matrix and projection in one native call per
// frame, and every button's hit target in a second (rust-ui/src/scene_entry_frame.rs). The host
// writes the inputs into the retained arena and reads the results from it; `refresh` follows
// any growth of memory (call it before using the views after other native work).
export const ENTRY_INPUT = 22, ENTRY_OUTPUT = 70, HIT_INPUT = 24, HIT_OUTPUT = 17;
export function createSceneEntryFrame(rust) {
  const native = new rust.RustSceneEntryFrame(), memory = native.memory(), roomAt = native.room_ptr();
  let count = -1, at = null, buffer = null, room = null, disposed = false;
  const frame = { input:null, output:null, hitInput:null, hitOutput:null, prepare, refresh, step, hits, free };
  function refresh() {
    if (disposed) throw new Error('Scene entry frame has been disposed');
    if (buffer === memory.buffer) return;
    buffer = memory.buffer; room = new Float64Array(buffer, roomAt, 16);
    frame.input = new Float64Array(buffer, at[0], count * ENTRY_INPUT);
    frame.output = new Float64Array(buffer, at[1], count * ENTRY_OUTPUT);
    frame.hitInput = new Float64Array(buffer, at[2], count * HIT_INPUT);
    frame.hitOutput = new Float64Array(buffer, at[3], count * HIT_OUTPUT);
  }
  function prepare(length) {
    if (disposed) throw new Error('Scene entry frame has been disposed');
    if (count !== length) {
      count = length; native.resize(count); buffer = null;
      at = [native.input_ptr(), native.output_ptr(), native.hit_input_ptr(), native.hit_output_ptr()];
    }
    refresh();
  }
  function step(motionFrame, scene, motion, transition, now, arranging, roomMatrix) {
    refresh(); room.set(roomMatrix.elements);
    native.step(motionFrame, scene, motion, transition, now, arranging); refresh();
  }
  function hits(projectionFrame, scene) { refresh(); native.hits(projectionFrame, scene); refresh(); }
  function free() {
    if (disposed) return;
    native.free(); disposed = true; buffer = room = frame.input = frame.output = frame.hitInput = frame.hitOutput = null;
  }
  return frame;
}
