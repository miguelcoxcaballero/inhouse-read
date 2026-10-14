import { needRustShelf } from './rust-shelf.js'

/** Touch navigation is sampled once per display frame; book holds remain native.
 * The recogniser, the pan/zoom maths and the coasting spring run in Rust
 * (rust-ui/src/shelf_zoom.rs, the `shelf` module the first shelf render awaits). */
export function createShelfZoom(options) {
  const shelf = needRustShelf()
  let native = new shelf.RustShelfZoom(options)
  return {
    sync() { native?.sync() },
    destroy() {
      if (!native) return
      const finished = native
      native = null
      try { finished.destroy() } finally { finished.free() }
    }
  }
}
