import { getRustShelf, requireRustShelf } from './rust-shelf.js'

// Reading owns the display (wake lock, Android reading mode and status-bar icons): the controller is
// rust-ui/src/reading_display.rs. It starts as soon as the shelf module is in, which the first shelf
// render awaits anyway; a book cannot open before then.
export function initReadingDisplay({ document:doc = document, window:win = window, navigator:nav = navigator } = {}) {
  let display = null, disposed = false
  const start = shelf => { if (!disposed) display = new shelf.RustReadingDisplay(doc, win, nav) }
  const ready = getRustShelf()
  if (ready) start(ready)
  else requireRustShelf().then(start).catch(error => console.error('No se pudo controlar la pantalla de lectura:', error))
  return { dispose() {
    if (disposed) return
    disposed = true
    if (display) { display.dispose(); display.free(); display = null }
  } }
}
