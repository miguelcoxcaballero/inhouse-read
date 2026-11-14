// Frozen from src/js/foliage-frame.js and src/js/bookshelf-scene.js 1.7.333: how the scene gathered
// the rectangles a plant's foliage takes no taps in, entry by entry, and copied them into the
// foliage arena. Production gathers them natively (rust-ui/src/scene_exclusions.rs).
export function prepareAreas(frame, areas) {
  const native = frame.native, count = areas.length;
  native.resize(count);
  const input = new Float64Array(native.memory().buffer, native.input_ptr(), count * 4);
  let index = 0;
  for (const area of areas) {
    input[index++] = area.left; input[index++] = area.right; input[index++] = area.top; input[index++] = area.bottom;
  }
  native.commit();
}
export function exclusionRects(bookEntries, progress) {
  const exclusionRects = [];
  for (const other of bookEntries) if (other.kind !== 'plant' && other.model?.visible && !other.flags.away && !other.flags.dragging) {
    const area = progress > .04 ? other.rect : other.hitRect;
    if (area) exclusionRects.push(area);
  }
  return exclusionRects;
}
