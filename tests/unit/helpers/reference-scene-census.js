// Frozen from bookshelf-scene.js and scene-count-frame.js as of 1.7.329: what a frame asked of its
// entries one by one, in JavaScript. `lift(entry)` and `easing(entry)` were the entry arena's
// reads (column 5; columns 9 and 20); `counts` is the kernel both sides share (rust.scene_counts).
// The casters' signature is the frozen original's (reference-bookshelf-scene.js), taken every frame.
export function referenceCounts(counts, entries, target) {
  const input = new Float64Array(entries.length * 5);
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index], model = entry.model, at = index * 5;
    input[at] = entry.kind === 'plant' ? 1 : entry.kind === 'lamp' ? 2 : 0;
    input[at + 1] = model?.visible ? 1 : 0;
    input[at + 2] = entry.qualityReplacement || entry.plantQuality ? 1 : 0;
    input[at + 3] = model?.userData.overview ? 1 : 0;
    input[at + 4] = model?.userData.inspectionResolution;
  }
  return counts(input, target);
}
export function referenceCasters(entries, trashVisible) {
  let casters = trashVisible ? 1 : 0;
  for (const entry of entries) if (entry.model?.visible) casters = Math.imul(casters, 31) + entry.model.id | 0;
  return casters;
}
export const referenceOverlay = entries => entries.some(entry => entry.insertion?.overlayCanvas);
export const referenceNative = entries => entries.some(entry => entry.insertion?.nativePresentation);
export const referenceTouched = (entries, lift) => entries.some(entry => lift(entry) || entry.flags.pressed);
export const referenceBusy = (entries, easing) => entries.some(entry => entry.insertion || entry.trashDrop || easing(entry));
export function referencePaintedAway(entries, painted) {
  painted.clear();
  for (const entry of entries) if (entry.flags.away && entry.model && !entry.model.visible &&
    !entry.insertion && !entry.trashDrop) painted.add(entry);
}
