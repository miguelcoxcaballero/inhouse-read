// Host object fields enter Rust's retained frame arena directly. No temporary
// numeric arrays, per-frame key serialization or wasm-bindgen slice copies.
// Views are reacquired after any native work that may grow linear memory.
export function createGravityFrame(rust) {
  const native = new rust.RustGravityFrame(), memory = native.memory();
  let entries = null, count = 0, buffer = null, states, geometry, nativeOutput;
  let statesAt = 0, geometryAt = 0, outputAt = 0, disposed = false;
  const frame = { output:new Float64Array(0), prepare, write, advance, copyState, free };
  function refresh() {
    if (disposed) throw new Error('Gravity frame has been disposed');
    if (buffer === memory.buffer) return;
    buffer = memory.buffer;
    states = new Float64Array(buffer, statesAt, count * 37);
    geometry = new Float64Array(buffer, geometryAt, count * 9);
    nativeOutput = new Float64Array(buffer, outputAt, count * 4);
  }
  function prepare(next) {
    if (disposed) throw new Error('Gravity frame has been disposed');
    // Shelf layouts replace their entry array, including same-length reorders.
    if (entries === next) return;
    native.register(next.map(entry => entry.key)); entries = next; count = next.length;
    statesAt = native.states_ptr(); geometryAt = native.geometry_ptr(); outputAt = native.output_ptr();
    if (frame.output.length !== count * 4) frame.output = new Float64Array(count * 4);
    buffer = null; refresh();
  }
  function write(index, entry, kind, undershelf, row, pixelsPerMetre, shelfWidth) {
    refresh();
    const at = index * 37, g = index * 9, lift = entry.lift, landing = entry.landing, preview = entry.preview;
    states[at] = kind; states[at+1] = undershelf ? 1 : 0; states[at+2] = entry.bits;
    states[at+3] = entry.dragNumberX; states[at+4] = entry.dragNumberY;
    states[at+5] = lift.value; states[at+6] = lift.from; states[at+7] = lift.target; states[at+8] = lift.started;
    states[at+9] = landing ? 1 : 0;
    if (landing) { states[at+10] = landing.from; states[at+11] = landing.started; states[at+12] = landing.duration; }
    states[at+13] = preview.x; states[at+14] = preview.y; states[at+15] = preview.fromX; states[at+16] = preview.fromY;
    states[at+17] = preview.targetX; states[at+18] = preview.targetY; states[at+19] = preview.started; states[at+20] = preview.active ? 1 : 0;
    states[at+21] = entry.offset.x; states[at+22] = entry.offset.y;
    states[at+23] = entry.x; states[at+24] = entry.y; states[at+25] = entry.width; states[at+26] = entry.height;
    states[at+27] = entry.depth; states[at+28] = entry.depthInset;
    geometry[g] = kind ? entry.width : entry.thickness; geometry[g+1] = undershelf ? 3 : kind;
    geometry[g+2] = entry.shelf || 0; geometry[g+3] = pixelsPerMetre;
    geometry[g+4] = row.left || 0; geometry[g+5] = row.right ?? shelfWidth;
    geometry[g+6] = row.bottom ?? entry.y + entry.height / 2;
    geometry[g+7] = row.ceiling ?? row.top ?? 0; geometry[g+8] = entry.gripHeight || 0;
  }
  function advance(gravity, scene, now, reduced) {
    if (disposed) throw new Error('Gravity frame has been disposed');
    native.advance(gravity, scene, now, reduced); refresh();
    // Presentation calls into other native modules between entries. This tiny
    // owned output stays valid even if those modules grow the shared memory.
    frame.output.set(nativeOutput);
  }
  function copyState(index, target) {
    refresh(); const at = index * 37;
    for (let field = 0; field < 37; field++) target[field] = states[at + field];
  }
  function free() {
    if (disposed) return;
    native.free(); disposed = true; entries = null; buffer = states = geometry = nativeOutput = null;
    frame.output = new Float64Array(0);
  }
  return frame;
}
