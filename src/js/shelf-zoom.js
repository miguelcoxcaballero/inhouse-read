import { getRustUI } from './rust-ui.js'
import { onRustUIReady } from './rust-ui-readiness.js'

/** Touch navigation is sampled once per display frame; book holds remain native.
 * The recogniser, the pan/zoom maths and the coasting spring run in Rust
 * (rust-ui/src/shelf_zoom.rs). The module is requested once the shelf has drawn
 * its first frame, so a finger that lands before it arrives is simply not a zoom
 * gesture yet; the controller attaches the moment the module is ready. */
export function createShelfZoom(options) {
  let native = null, destroyed = false, unsubscribe = null
  const adopt = ui => {
    if (destroyed || native) return
    native = new ui.RustShelfZoom(options)
  }
  const ready = getRustUI()
  if (ready) adopt(ready)
  else unsubscribe = onRustUIReady(adopt)
  return {
    sync() { native?.sync() },
    destroy() {
      if (destroyed) return
      destroyed = true
      unsubscribe?.()
      if (native) { try { native.destroy() } finally { native.free(); native = null } }
    }
  }
}
