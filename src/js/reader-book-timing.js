// Keep the physical phases readable, with less time blocking reader controls.
// GPU and fallback transitions use the same schedule; rendering quality and
// the renderer's step caps are independent of these interaction durations.
const freeze = values => Object.freeze(values);
const normal = freeze({
  opening: freeze({ cover:480, bookmark:240, zoom:520, handoff:140 }),
  closing: freeze({ zoom:460, bookmark:260, cover:440, flight:560 })
});
const reduced = freeze({
  opening: freeze({ cover:1, bookmark:1, zoom:1, handoff:1 }),
  closing: freeze({ zoom:1, bookmark:1, cover:1, flight:1 })
});

export function readerBookTiming(reducedMotion = false) {
  return reducedMotion ? reduced : normal;
}
