// Frozen from src/js/bookshelf-scene.js 1.7.339: the boxes the host kept on every entry and whether
// the bin's box on screen stood, before the arena and the view answered both (rust-ui/src/
// scene_entry_frame.rs `boxes_of`, scene_bin.rs `bin_moved`). Do not edit.

// placeBoxes: the slot's box and the stand-in hit box of a culled model, once per change of size.
const boxScratch = new Float64Array(12);
export function referencePlaceBoxes(rust, entry) {
  rust.scene_entry_boxes(entry.kind === 'plant' ? 1 : entry.kind === 'lamp' ? 2 : 0, entry.mount === 'undershelf',
    entry.width, entry.height, entry.thickness, entry.depth, boxScratch);
  entry.box = boxScratch.slice(0, 6); entry.fallback = boxScratch.slice(6, 12); entry.stale = true;
}
// The stand-in hit box of a culled model only changes with its slot box.
export const referenceFallbackBox = (entry, lamp) => lamp ? entry.box : entry.fallback;

// binStands: what the bin's box on screen was last taken from (its lid's opening, the room's world
// matrix and its own place, turn and size), compared bit for bit in every frame without a drop.
export function createReferenceBinStands(furniture) {
  const binNow = new Float64Array(27), binHeld = new Float64Array(27);
  const binNowBits = new Uint32Array(binNow.buffer), binHeldBits = new Uint32Array(binHeld.buffer);
  const host = { binStale:true, stands(trash, openness) {
    const now = binNow, room = furniture.matrixWorld.elements, { position, quaternion, scale } = trash;
    now[0] = openness;
    for (let index = 0; index < 16; index++) now[index + 1] = room[index];
    now[17] = position.x; now[18] = position.y; now[19] = position.z;
    now[20] = quaternion.x; now[21] = quaternion.y; now[22] = quaternion.z; now[23] = quaternion.w;
    now[24] = scale.x; now[25] = scale.y; now[26] = scale.z;
    // Bit for bit (a zero that changed its sign is a change).
    let same = !host.binStale;
    for (let index = 0; same && index < 54; index++) same = binNowBits[index] === binHeldBits[index];
    if (same) return true;
    binHeld.set(now); host.binStale = false;
    return false;
  } };
  return host;
}
