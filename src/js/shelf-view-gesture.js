import { getRustShelf } from './rust-shelf.js'

/** A short horizontal swipe turns the cabinet; holds, scrolling and pinches
 * retain their existing owners. The recogniser runs in Rust
 * (rust-ui/src/shelf_view_gesture.rs, the `shelf` module the first shelf render awaits). */
export function createShelfViewGesture(options) {
  const shelf = getRustShelf()
  if (!shelf) throw new Error('El módulo de la estantería no está cargado.')
  let native = new shelf.RustShelfViewGesture(options)
  return {
    destroy() {
      if (!native) return
      const finished = native
      native = null
      try { finished.destroy() } finally { finished.free() }
    }
  }
}
