// Keep the physical phases readable, with less time blocking reader controls.
// GPU and fallback transitions use the same schedule; rendering quality and
// the renderer's step caps are independent of these interaction durations.
const freeze = values => Object.freeze(values);
const normal = freeze({
  opening: freeze({ cover:480, bookmark:240, zoom:520, handoff:140 }),
  closing: freeze({ zoom:460, bookmark:260, cover:440, flight:560 }),
  // Closing is one movement: each step starts this long before the previous
  // one settles (the ribbon while the page still lands in the open book, the
  // board as the ribbon lies down, the flight as the board shuts).
  closingLead: freeze({ bookmark:110, cover:60, flight:120 })
});
const reduced = freeze({
  opening: freeze({ cover:1, bookmark:1, zoom:1, handoff:1 }),
  closing: freeze({ zoom:1, bookmark:1, cover:1, flight:1 }),
  closingLead: freeze({ bookmark:0, cover:0, flight:0 })
});

export function readerBookTiming(reducedMotion = false) {
  return reducedMotion ? reduced : normal;
}

// Share of the flight spent travelling; the rest slides the book into its slot.
export const RETURN_APPROACH = .66;

/** Milliseconds, from the first zoom-out frame, at which every closing step
 * starts and ends. `motion` is the overlapped zoom/ribbon/board/approach
 * movement; the shelf's insertion follows it. */
export function readerBookClosingSchedule(reducedMotion = false) {
  const { closing, closingLead } = readerBookTiming(reducedMotion);
  const zoom = { start:0, end:closing.zoom };
  const bookmark = { start:Math.max(0, zoom.end - closingLead.bookmark) };
  bookmark.end = bookmark.start + closing.bookmark;
  const cover = { start:Math.max(bookmark.start, bookmark.end - closingLead.cover) };
  cover.end = cover.start + closing.cover;
  const approach = { start:Math.max(cover.start, cover.end - closingLead.flight) };
  approach.end = approach.start + closing.flight * RETURN_APPROACH;
  const insertion = { start:approach.end, end:approach.start + closing.flight };
  return freeze({ zoom:freeze(zoom), bookmark:freeze(bookmark), cover:freeze(cover),
    approach:freeze(approach), insertion:freeze(insertion), motion:approach.end, total:insertion.end });
}
