import { getRustShelf, whenRustShelf } from './rust-shelf.js'

// «Sin avisos al leer» (solo en la app Android): con un libro abierto, un modo No
// molestar de la app oculta las notificaciones emergentes. The settings switch is
// rust-ui/src/reading_focus.rs.

/** Enlaza el interruptor de Ajustes. Devuelve una función que lo desmonta. */
export function bindReadingFocus(document, view = document.defaultView) {
  const shelf = getRustShelf()
  if (shelf) return shelf.reading_focus_bind(document, view)
  // The switch lives in the settings menu: it is bound once the shelf module, which the
  // first shelf render awaits, is in.
  let release = null, released = false
  whenRustShelf(shelf => { if (!released) release = shelf.reading_focus_bind(document, view) })
  return () => { released = true; release?.() }
}
