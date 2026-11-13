import { whenRustShelf } from './rust-shelf.js'

// The Rust controller is freed with its JavaScript handle, and app.js never reads the handle again:
// keep it here until it is disposed, so collecting garbage cannot unhook its observers and listeners.
const live = new Set()

// Reading owns the display (wake lock, Android reading mode and status-bar icons): the controller is
// rust-ui/src/reading_display.rs. It starts as soon as the shelf module is in, which the first shelf
// render awaits anyway; a book cannot open before then.
export function initReadingDisplay({ document:doc = document, window:win = window, navigator:nav = navigator } = {}) {
  let display = null, disposed = false
  const start = shelf => { if (!disposed) display = new shelf.RustReadingDisplay(doc, win, nav) }
  whenRustShelf(start)
  const handle = { dispose() {
    if (disposed) return
    disposed = true
    live.delete(handle)
    if (display) { display.dispose(); display.free(); display = null }
  } }
  live.add(handle)
  return handle
}
