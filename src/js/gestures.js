import { readerUI } from './readers/rust-ui-required.js'

// Shared reader gestures. Native scrolling and text selection retain ownership
// of vertical drags; an optional page surface follows horizontal PDF swipes.
// The recogniser, the tap/double-tap/hold timing and the damped page spring run
// in Rust (rust-ui/src/gestures.rs); this file only names the zones. The reader
// builds its gestures after the lazy reader has awaited the Rust UI module.
export const ZONE = { PREV: 'prev', NEXT: 'next', CENTER: 'center' }

export const classifyTapZone = (x, width) => readerUI().classify_tap_zone(x, width)

export function classifySwipe({ dx, dy, durationMs, velocityX = 0 }) {
  return readerUI().classify_swipe(dx, dy, durationMs, velocityX) ?? null
}

/** Returns a detach function, including pending taps and animation frames. */
export function attachSwipeNavigation(el, options = {}) {
  let navigation = new (readerUI().RustSwipeNavigation)(el, options)
  return () => {
    if (!navigation) return
    const finished = navigation
    navigation = null
    try { finished.detach() } finally { finished.free() }
  }
}
