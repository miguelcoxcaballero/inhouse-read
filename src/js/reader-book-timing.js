// Keep the physical phases readable, with less time blocking reader controls.
// GPU and fallback transitions use the same schedule; rendering quality and
// the renderer's step caps are independent of these interaction durations.
//
// Opening is one continuous motion: each phase keeps its own duration but
// starts at `…At` on the same clock, overlapping the end of the one before
// (the ribbon slides out while the board settles, the camera leans into the
// page as the spread comes to rest). It lasts zoomAt + zoom + handoff.
const freeze = values => Object.freeze(values);
const normal = freeze({
  opening: freeze({ cover:520, bookmark:280, zoom:580, handoff:120, bookmarkAt:250, zoomAt:450 }),
  closing: freeze({ zoom:460, bookmark:260, cover:440, flight:560 })
});
const reduced = freeze({
  opening: freeze({ cover:1, bookmark:1, zoom:1, handoff:1, bookmarkAt:0, zoomAt:0 }),
  closing: freeze({ zoom:1, bookmark:1, cover:1, flight:1 })
});

export function readerBookTiming(reducedMotion = false) {
  return reducedMotion ? reduced : normal;
}

/** Total length of the overlapped opening, from the tap to the reader. */
export function openingDuration({ cover, bookmark, zoom, handoff, bookmarkAt = 0, zoomAt = 0 }) {
  return Math.max(cover, bookmarkAt + bookmark, zoomAt + zoom) + handoff;
}

// The opening's curves, as CSS cubic-bezier control points: the board lifts
// gently and lands softly, the ribbon slides, and the camera leans into the
// page with a long, decelerating landing so the hand-off happens at rest.
export const OPENING_EASING = Object.freeze({
  spread:Object.freeze([.4, 0, .2, 1]),
  hinge:Object.freeze([.45, 0, .25, 1]),
  ribbon:Object.freeze([.4, 0, .3, 1]),
  zoom:Object.freeze([.42, 0, .1, 1]),
  theme:Object.freeze([.4, 0, .4, 1])
});
export const cssEasing = ([x1, y1, x2, y2]) => `cubic-bezier(${x1}, ${y1}, ${x2}, ${y2})`;

/** CSS cubic-bezier timing as a function of progress (0..1). */
export function cubicBezier([x1, y1, x2, y2]) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const x = t => ((ax * t + bx) * t + cx) * t, y = t => ((ay * t + by) * t + cy) * t;
  const slope = t => (3 * ax * t + 2 * bx) * t + cx;
  return progress => {
    if (!(progress > 0)) return 0;
    if (!(progress < 1)) return 1;
    let t = progress;
    for (let i = 0; i < 8; i++) {
      const error = x(t) - progress, d = slope(t);
      if (Math.abs(error) < 1e-7) return y(t);
      if (Math.abs(d) < 1e-6) break;
      t -= error / d;
    }
    let low = 0, high = 1;
    t = progress;
    for (let i = 0; i < 32 && Math.abs(x(t) - progress) > 1e-7; i++) {
      if (x(t) < progress) low = t; else high = t;
      t = (low + high) / 2;
    }
    return y(t);
  };
}
