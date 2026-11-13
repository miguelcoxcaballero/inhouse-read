// Test harness: the production module src/js/readers/page-snapshot.js and the doorways to the Rust kernels that only the
// tests and the frozen references use (no production module imports them, so they left src).
export * from '../../../src/js/readers/page-snapshot.js'
import { readerUI } from '../../../src/js/readers/rust-ui-required.js'
export const plainBounds = rect => readerUI().snapshot_bounds(rect)
/** Does a computed CSS colour (rgb()) equal a theme colour (#rrggbb)? */
export const sameColor = (a, b) => readerUI().snapshot_same_color(a, b)
