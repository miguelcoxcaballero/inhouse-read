import { needRustShelf } from './rust-shelf.js'

/** A short horizontal swipe turns the cabinet; holds, scrolling and pinches
 * retain their existing owners. The recogniser runs in Rust
 * (rust-ui/src/shelf_view_gesture.rs, the `shelf` module the first shelf render awaits). */
export function createShelfViewGesture(options) {
  const shelf = needRustShelf()
  let native = new shelf.RustShelfViewGesture(options)
  return {
    cancel() { native?.cancel() },
    destroy() {
      if (!native) return
      const finished = native
      native = null
      try { finished.destroy() } finally { finished.free() }
    }
  }
}
