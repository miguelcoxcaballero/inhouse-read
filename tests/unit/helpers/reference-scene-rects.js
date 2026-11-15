// Frozen from src/js/bookshelf-scene.js 1.7.339: the host's tap search, a reorder's release and the
// read of a button's state, before they moved into rust-ui/src/scene_rects.rs. Do not edit.

// tapTargetNear: the entries' own `tapRect`, `node`, `model`, `flags`, `trashDrop` and `kind`.
export function createReferenceTap(rust) {
  let tapNodes = [], tapPacked = new Float64Array(0);
  return function tapTargetNear(bookEntries, origin, clientX, clientY) {
    const count = bookEntries.length;
    if (tapPacked.length !== count * 4) tapPacked = new Float64Array(count * 4);
    tapNodes.length = count; tapNodes.fill(null);
    for (let index = 0; index < count; index++) {
      const entry = bookEntries[index], tap = entry.tapRect, at = index * 4;
      if (!tap || !entry.node || !entry.model?.visible || entry.flags?.away || entry.flags?.dragging || entry.trashDrop ||
          entry.kind === 'plant' || entry.node.classList.contains('is-away')) {
        // Keep stable indices without allocating a compact array for each hit.
        tapPacked[at] = Infinity; tapPacked[at + 1] = tapPacked[at + 2] = tapPacked[at + 3] = 0;
        continue;
      }
      tapNodes[index] = entry.node;
      tapPacked[at] = tap.left + origin.left; tapPacked[at + 1] = tap.top + origin.top;
      tapPacked[at + 2] = tap.width; tapPacked[at + 3] = tap.height;
    }
    return tapNodes[rust.scene_nearest_tap(tapPacked, clientX, clientY)] ?? null;
  };
}

// animateFromRects, up to the paint: the items handed to the arena and the dragged entry's landing
// (`lift` is the entry's lift value, column 5 of its row).
export function referenceReorder(bookEntries, oldRects, stageRect, draggedKey, lift, started) {
  const items = [];
  let dragged = null;
  for (const entry of bookEntries) {
    const old = oldRects.get(entry.node?.dataset.objectId) || oldRects.get(entry.book?.id) ||
      oldRects.get(entry.node?.dataset.bookId) || oldRects.get(entry.key);
    const targetRect = entry.tapRect || entry.hitRect || entry.rect;
    if (!old || !targetRect) continue;
    const x = old.left - (targetRect.left + stageRect.left), y = old.top - (targetRect.top + stageRect.top);
    if (Math.abs(x) + Math.abs(y) > 1) {
      items.push(entry.row, x, y);
      if (draggedKey != null) dragged ||= String(entry.node?.dataset.objectId ?? entry.key) === String(draggedKey) && entry;
    }
  }
  let landing = null;
  if (dragged && lift(dragged) > 0) landing = { row:dragged.row, values:[1, lift(dragged), started, 520] };
  return { items, landing };
}

// stateFor: the entry keeps `bits`, `flags`, `dragNumberX`, `dragNumberY` and `stateText`.
export function referenceStateFor(rust, entry) {
  const node = entry.node;
  if (!node) return '';
  const classes = node.className, dragX = node.style.getPropertyValue('--ihr-drag-x'), dragY = node.style.getPropertyValue('--ihr-drag-y');
  const disabled = Boolean(node.disabled), pointerEvents = node.style.pointerEvents;
  if (classes === entry.classText && dragX === entry.dragX && dragY === entry.dragY &&
    disabled === entry.controlDisabled && pointerEvents === entry.controlPointerEvents) return entry.stateText;
  if (classes !== entry.classText) {
    const bits = entry.bits = rust.scene_class_flags(classes);
    entry.flags = { away:Boolean(bits & 1), dragging:Boolean(bits & 2), lifted:Boolean(bits & 4), pressed:Boolean(bits & 8) };
    entry.classText = classes;
  }
  if (dragX !== entry.dragX) entry.dragNumberX = rust.scene_drag_offset(dragX);
  if (dragY !== entry.dragY) entry.dragNumberY = rust.scene_drag_offset(dragY);
  entry.dragX = dragX; entry.dragY = dragY;
  entry.controlDisabled = disabled; entry.controlPointerEvents = pointerEvents;
  return entry.stateText = rust.scene_state_text(entry.bits, dragX, dragY, disabled, pointerEvents);
}

// The frame's copy of a hit target into the entry's objects (updateEntries' third loop), from
// the seventeen numbers `hits` leaves per entry.
export function referenceCopyTarget(entry, hit, h, plant) {
  const dirtyStyle = hit[h];
  if (dirtyStyle & 8192 || !entry.hitRect) {
    const hitRect = entry.hitRect || (entry.hitRect = {});
    hitRect.left = hit[h + 1]; hitRect.right = hit[h + 2]; hitRect.top = hit[h + 3]; hitRect.bottom = hit[h + 4];
    hitRect.width = hit[h + 5]; hitRect.height = hit[h + 6]; hitRect.closest = hit[h + 7];
  }
  if (!plant && (dirtyStyle & 8192 || !entry.tapRect)) {
    const tapRect = entry.tapRect || (entry.tapRect = {});
    tapRect.left = hit[h + 8]; tapRect.top = hit[h + 9]; tapRect.width = hit[h + 10]; tapRect.height = hit[h + 11];
  }
}
