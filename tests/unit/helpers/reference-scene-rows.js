// Frozen copies of what the host did itself until 1.7.338 (bookshelf-scene.js and
// scene-entry-frame.js), kept only to compare rust-ui/src/scene_rows.rs against: the arena's rows
// across a layout, a reorder's offsets, the room's epoch and the stamp that decided when a
// decoration's solid was described.

// scene-entry-frame.js `bind`, over a plain state array: `held` is the former arena.
export function referenceBind(held, entries, reset, stride) {
  const state = new Float64Array(entries.length * stride);
  // `prepare` resized the arena in place: the rows that stay keep their former numbers first.
  if (held) state.set(held.subarray(0, Math.min(held.length, state.length)));
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index], to = index * stride, from = entry.row * stride;
    if (held && entry.row >= 0) state.set(held.subarray(from, from + stride), to);
    else state.fill(0, to, to + stride);
    if (reset) state.fill(0, to + 9, to + 21);
    state[to + 71] = state[to + 73] = 1; entry.row = index;
  }
  return state;
}

// bookshelf-scene.js draw: `if (begun & 2) { ... }` over `reorderItems`.
export function referenceReorderStep(state, items, amount, ended, stride) {
  for (const item of items) { const at = item.entry.row * stride; state[at + 21] = item.x * amount; state[at + 22] = item.y * amount; }
  return ended ? [] : items;
}
// bookshelf-scene.js updateLayout.
export const referenceReorderKeep = (items, retained, reordering) => reordering ? items.filter(item => retained.includes(item.entry)) : items;

// bookshelf-scene.js roomEpochNow.
export function createReferenceRoomEpoch() {
  const roomNow = new Float64Array(16), roomHeld = new Float64Array(16).fill(NaN);
  const roomNowBits = new Uint32Array(roomNow.buffer), roomHeldBits = new Uint32Array(roomHeld.buffer);
  let roomEpoch = 0, roomMoved = true;
  return room => {
    for (let index = 0; index < 16; index++) roomNow[index] = room[index];
    let same = true;
    for (let index = 0; same && index < 32; index++) same = roomNowBits[index] === roomHeldBits[index];
    roomMoved = !same;
    if (!same) { roomHeld.set(roomNow); roomEpoch++; }
    return [roomEpoch, roomMoved];
  };
}

// bookshelf-scene.js updateEntries: whether a standing decoration's solid is described this frame.
export function referenceStamped(entry, pixelsPerMetre) {
  const stamp = entry.collisionStamp;
  if (!stamp || stamp.height !== entry.height || stamp.width !== entry.width || stamp.catalogId !== entry.catalogId ||
      stamp.variant !== entry.variant || stamp.potId !== entry.potId || stamp.lampId !== entry.lampId || stamp.pixelsPerMetre !== pixelsPerMetre) {
    entry.collisionStamp = { height:entry.height, width:entry.width, catalogId:entry.catalogId, variant:entry.variant,
      potId:entry.potId, lampId:entry.lampId, pixelsPerMetre };
    return true;
  }
  return false;
}
