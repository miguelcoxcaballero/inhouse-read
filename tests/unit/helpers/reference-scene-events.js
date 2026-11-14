// Frozen from bookshelf-scene.js as of 1.7.330: the recipes that moved to rust-ui/src/scene_events.rs,
// with the scene's closure variables as parameters and nothing else changed.

// draw(): a room at rest is stored and acknowledged (inside the scene's try block).
export function roomSave(rust, saved, records, physicsStorageKey, physicsInteracted, acknowledgeRoom) {
  const canonical = rust.room_physics_canonical(saved, records);
  const existing = localStorage.getItem(physicsStorageKey);
  // Received resting geometry is authoritative. A passive render/resize
  // must neither rewrite it nor turn solver roundoff into a local edit.
  const preserve = !physicsInteracted && existing && rust.room_physics_passive_compatible(existing, canonical);
  if (!preserve) {
    localStorage.setItem(physicsStorageKey, canonical);
    acknowledgeRoom(canonical);
  }
}

// draw(): the idle preparation of one visible book, after `bookPresentationScheduled = true`.
// `retry` stands for `if (!disposed) bookPresentationScheduled = false`.
export function prepareResting(model, idleSlice, current, retry) {
  void (async () => {
    let prepared = false;
    try {
      if (!await model.userData.preparePresentation(idleSlice, current) || !current()) return;
      prepared = typeof model.userData.prepareDetailPresentation !== 'function' ||
        await model.userData.prepareDetailPresentation(idleSlice, current);
    } catch (error) {
      console.warn('No se pudo preparar el libro en reposo:', error);
    } finally {
      // A busy/hidden owner or failed driver can cancel either phase.
      // Permit another already-required stable paint to retry; settling
      // background preparation must never schedule a frame of its own.
      if (!prepared) retry();
    }
  })();
}

// resolveDropPosition(): the solver's answer for an entry on a row of the cabinet.
export function resolveDrop(bookGravity, entry, position, row, width, pixelsPerMetre) {
  const left = row.left || 0, right = row.right ?? width, padding = row.padding ?? 16;
  const available = right - left - padding * 2;
  const result = bookGravity.drop_position(entry.key, new Float64Array([
    position.shelf, left + padding + position.x * available, left, right,
    row.bottom, row.ceiling ?? row.top, pixelsPerMetre
  ]));
  return result.length && available > 0
    ? { ...position, x:(result[0] - left - padding) / available } : null;
}
