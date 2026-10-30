import { whenRustShelf } from './rust-shelf.js'

// Reading owns the display (wake lock, Android reading mode and status-bar icons): the controller is
// rust-ui/src/reading_display.rs. It starts as soon as the shelf module is in, which the first shelf
// render awaits anyway; a book cannot open before then.
export function initReadingDisplay({ document:doc = document, window:win = window, navigator:nav = navigator } = {}) {
  let display = null, disposed = false
  const start = shelf => { if (!disposed) display = new shelf.RustReadingDisplay(doc, win, nav) }
  whenRustShelf(start)
  return { dispose() {
    if (disposed) return
    disposed = true
    if (display) { display.dispose(); display.free(); display = null }
  } }
}
