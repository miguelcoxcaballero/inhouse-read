// Every entry's state and pose live in one retained arena (rust-ui/src/scene_entry_frame.rs):
// a frame is one native call that eases every lift, landing and preview (or steps the rigid
// bodies), composes each pose matrix, places it in the room and projects it; a second call
// takes every button's hit target. The host writes a column of `state` only when its source
// changes and reads the results from the arena; `refresh` follows any growth of memory (call
// it before using the views after other native work).
export const ENTRY_STATE = 89, ENTRY_INPUT = 22, ENTRY_OUTPUT = 70, HIT_INPUT = 24, HIT_OUTPUT = 17;
// A settled entry's frame: its overview flag and resolution are stored on it as
// rust.scene_update_quality stores them, and the answer is whether that call has anything else
// to do: the model is at another quality (scene_quality.rs `matches`), or a replacement or a
// plant texture is under way. Every visible book and plant passes here in every frame.
export function settledQualityWork(entry, overview, resolution) {
  entry.overview = overview; entry.inspectionResolution = resolution;
  const data = entry.model?.userData;
  return Boolean(entry.plantQuality || entry.qualityReplacement ||
    data && !(Boolean(data.overview) === overview && (data.inspectionResolution || 0) === resolution));
}
export function createSceneEntryFrame(rust) {
  const native = new rust.RustSceneEntryFrame(), memory = native.memory(), roomAt = native.room_ptr();
  let count = -1, at = null, buffer = null, room = null, disposed = false, resolutions = '';
  const frame = { state:null, input:null, output:null, hitInput:null, hitOutput:null, counts:null, get resolutions() { return resolutions; },
    census, painted:() => native.painted(), qualityHold:(scene, eligible, now) => native.quality_hold(scene, eligible, now),
    prepare, bind, refresh, step, poses, settle, place, settled, hits, preview, motionRest, motionBegin, motionPoses, free };
  function refresh() {
    if (disposed) throw new Error('Scene entry frame has been disposed');
    if (buffer === memory.buffer) return;
    buffer = memory.buffer; room = new Float64Array(buffer, roomAt, 16); frame.counts = new Float64Array(buffer, native.census_ptr(), 9);
    frame.input = new Float64Array(buffer, at[0], count * ENTRY_INPUT);
    frame.output = new Float64Array(buffer, at[1], count * ENTRY_OUTPUT);
    frame.hitInput = new Float64Array(buffer, at[2], count * HIT_INPUT);
    frame.hitOutput = new Float64Array(buffer, at[3], count * HIT_OUTPUT);
    frame.state = new Float64Array(buffer, at[4], count * ENTRY_STATE);
  }
  function prepare(length) {
    if (disposed) throw new Error('Scene entry frame has been disposed');
    if (count !== length) {
      count = length; native.resize(count); buffer = null;
      at = [native.input_ptr(), native.output_ptr(), native.hit_input_ptr(), native.hit_output_ptr(), native.state_ptr()];
    }
    refresh();
  }
  // A layout's entries take the arena's rows in their new order. A retained entry (`row` is
  // its former place) keeps its state, a new one starts from zeros; `reset` clears every
  // landing and preview, as a committed layout does. Each row is marked as not yet held by
  // the host, so the next frame hands over its whole pose, rectangle and hit target.
  function bind(entries, reset) {
    const held = count > 0 ? (refresh(), frame.state.slice()) : null;
    prepare(entries.length);
    const state = frame.state;
    for (let index = 0; index < entries.length; index++) {
      const entry = entries[index], to = index * ENTRY_STATE, from = entry.row * ENTRY_STATE;
      if (held && entry.row >= 0) state.set(held.subarray(from, from + ENTRY_STATE), to);
      else state.fill(0, to, to + ENTRY_STATE);
      if (reset) state.fill(0, to + 9, to + 21);
      state[to + 71] = state[to + 73] = 1; entry.row = index;
    }
  }
  // What the host holds of each entry now, for the frame's own questions (rust-ui/src/scene_census.rs):
  // the result's bits are loading 2, overlay insertion 4, native insertion 8, busy 16, touched 32;
  // `counts` holds the casters' signature and the diagnostics' counts, and the books' resolutions follow.
  function census(entries, trashVisible) {
    refresh();
    for (let index = 0, state = frame.state, to = 85; index < entries.length; index++, to += ENTRY_STATE) {
      const entry = entries[index], model = entry.model, data = model?.userData, insertion = entry.insertion, quality = entry.plantQuality;
      state[to] = (model ? data.overview ? 9 : 1 : 0) | (model?.visible ? 2 : 0) | (entry.qualityReplacement || quality ? 4 : 0) |
        (insertion ? insertion.overlayCanvas ? 80 : 16 : 0) | (entry.trashDrop ? 32 : 0) | (insertion?.nativePresentation ? 128 : 0) |
        (entry.qualityReplacement && !entry.replacementReady || quality && !quality.ready ? 256 : 0);
      state[to + 1] = data?.inspectionResolution; state[to + 2] = model ? model.id : 0;
    }
    const held = native.census(trashVisible);
    if (held & 1) resolutions = native.resolutions();
    refresh();
    return held;
  }
  function step(motionFrame, scene, motion, transition, now, arranging, roomMatrix) {
    refresh(); room.set(roomMatrix.elements);
    native.step(motionFrame, scene, motion, transition, now, arranging); refresh();
  }
  // The results of the three calls below: moving | shelf moving << 1 | previewing << 2 | previewed << 3.
  function poses(motionFrame, scene, motion, transition, now, arranging, roomMatrix) {
    refresh(); room.set(roomMatrix.elements);
    const summary = native.poses(motionFrame, scene, motion, transition, now, arranging); refresh();
    return summary;
  }
  function settle(gravityFrame, gravity, scene, now, reduced) { native.settle(gravityFrame, gravity, scene, now, reduced); refresh(); }
  function place(physics, motionFrame, scene, motion, transition, now, arranging, roomMatrix) {
    refresh(); room.set(roomMatrix.elements);
    const summary = native.place(physics, motionFrame, scene, motion, transition, now, arranging); refresh();
    return summary;
  }
  function settled(gravityFrame, gravity, motionFrame, scene, motion, transition, now, reduced, arranging, roomMatrix) {
    refresh(); room.set(roomMatrix.elements);
    const summary = native.settled(gravityFrame, gravity, motionFrame, scene, motion, transition, now, reduced, arranging); refresh();
    return summary;
  }
  // The shared room's local motion (the entries' local poses stay in the state arena): the poses
  // at rest, the start of a gesture, and a gesture's frame as the rows the room publishes,
  // `[key, shelf, x, y, z, quaternion, scale]` for every entry of a key the gesture has moved.
  function motionRest(motionFrame) { native.motion_rest(motionFrame.native); }
  function motionBegin() { native.motion_begin(); }
  function motionPoses(motionFrame) {
    const count = native.motion_publish(motionFrame.native), rows = new Float64Array(memory.buffer, native.published_ptr(), count * 10), poses = [];
    for (let at = 0; at < rows.length; at += 10)
      poses.push([motionFrame.name(rows[at]), rows[at+1], rows[at+2], rows[at+3], rows[at+4], rows[at+5], rows[at+6], rows[at+7], rows[at+8], rows[at+9]]);
    return poses;
  }
  // A drag move's placement previews, over the arena's preview columns: `placed` is ten numbers per
  // placed entry, in row order (rust-ui/src/scene_entry_frame.rs `preview`). Whether any offset changed.
  function preview(placed, now, reduced) { const changed = native.preview(placed, now, reduced); refresh(); return changed; }
  function hits(projectionFrame, scene) { refresh(); native.hits(projectionFrame, scene); refresh(); }
  function free() {
    if (disposed) return;
    native.free(); disposed = true; buffer = room = frame.counts = frame.state = frame.input = frame.output = frame.hitInput = frame.hitOutput = null;
  }
  return frame;
}
