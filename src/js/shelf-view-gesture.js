import { getRustUI } from './rust-ui.js'
import { onRustUIReady } from './rust-ui-readiness.js'

/** A short horizontal swipe turns the cabinet; holds, scrolling and pinches
 * retain their existing owners. The recogniser runs in Rust
 * (rust-ui/src/shelf_view_gesture.rs). The module is requested once the shelf
 * has drawn its first frame; the controller attaches the moment it is ready. */
export function createShelfViewGesture(options) {
  let native = null, destroyed = false, unsubscribe = null
  const adopt = ui => {
    if (destroyed || native) return
    native = new ui.RustShelfViewGesture(options)
  }
  const ready = getRustUI()
  if (ready) adopt(ready)
  else unsubscribe = onRustUIReady(adopt)
  return {
    destroy() {
      if (destroyed) return
      destroyed = true
      unsubscribe?.()
      if (native) { try { native.destroy() } finally { native.free(); native = null } }
    }
  }
}
