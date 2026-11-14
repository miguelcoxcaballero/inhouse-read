import { getRustCore } from './rust-core.js'
import { rustBookWeavePixels } from './book-surface-wasm.js'
import * as THREE from 'three'
import { spineFinish, surfaceFinish, SURFACE_FINISHES } from './book-colors.js'
import { normalizeBookAuthor } from './book-title.js'
import { needRustShelf } from './rust-shelf.js'

// The binding layout, the lettering fit and every canvas operation of a spine run in Rust
// (rust-ui/src/spine_surface.rs, the `shelf` module the first shelf render awaits), over the book's
// own pseudo-random stream. What stays here is the part that touches three.js, the pooled scratch
// canvases and the replay of a cloth's plan on its canvas.

/** Every publisher sets its spines a little differently: raised bands between
 * heavy and fine rules, fine double rules, a blind-stamped panel, or a plain
 * spine with a device at the tail. The case follows the book (id and title),
 * never its colour, so recolouring keeps the same binding. */
export const spineLayout = book => needRustShelf().spine_layout(book)

// A small printer's device, centred on (0, 0) in design units.
export const drawDevice = (c, kind, size) => needRustShelf().draw_device(c, kind, size)

/** Integer hash noise in [0, 1): the same cell always gets the same value. */
export const lattice = (i, j, salt) => needRustShelf().spine_lattice(i, j, salt)
export const textSeed = text => needRustShelf().spine_text_seed(text)

// A book's cloth, as the shelf module planned it from the book's own stream (rust-ui/src/spine_surface.rs,
// paint_cloth): the dye field in one soft-light pass, then each slub. Every slub sets its own colour string,
// so the replay stays beside the canvas (driven from the module it crossed the boundary about nine times per
// slub, ~150 slubs a cloth). `pixels` and `commands` are views of the module's memory, read before returning.
export function replayCloth(c, designWidth, fieldWidth, pixels, commands) {
  const field = Object.assign(document.createElement('canvas'), { width:fieldWidth, height:30 })
  const f = field.getContext('2d'), image = f.createImageData?.(fieldWidth, 30)
  if (image?.data) { image.data.set(pixels); f.putImageData(image, 0, 0) }
  c.save(); c.globalCompositeOperation = 'soft-light'; c.imageSmoothingEnabled = true
  c.imageSmoothingQuality = 'high'; c.drawImage(field, 0, 0, designWidth, 1024); c.restore()
  for (let at = 0; at < commands.length; at += 6) {
    c.fillStyle = commands[at + 5] ? `rgba(255,248,235,${commands[at + 4]})` : `rgba(0,0,0,${commands[at + 4]})`
    c.fillRect(commands[at], commands[at + 1], commands[at + 2], commands[at + 3])
  }
}

// The weave is painted by the shelf module (rust-ui/src/spine_surface.rs): plain weave, 16 × 16 threads per
// 128 px tile with uneven yarn, at 4.4 design units a thread (1024 = board height), so one case is one cloth.
// The two tiles are made on first use and kept on the host.
export const WEAVE = 4.4 / 8
/** Lay the weave over a canvas drawn in design units: colour by default, or
 * multiplied into a packed height/roughness/metal channel raster. */
export function paintWeave(c, designWidth, options) { needRustShelf().spine_paint_weave(host, c, designWidth, options) }

// The glyph mask, the ink layer and the relief sample never leave spineSurface,
// which runs to the end synchronously: reuse one raster of each kind instead of
// allocating, zeroing and later collecting up to three more full-size canvases
// per spine (a row of new books entering the scroll margin builds many in one
// task). reset() restores the default state and a transparent bitmap, exactly
// what a new canvas starts with. The CPU-read flag cannot change after the
// first getContext, so the relief rasters have kinds of their own. They are
// let go when the task ends: nothing is held while the shelf is idle.
const scratchRasters = {}
let scratchHeld = false
function scratchRaster(kind, width, height, attributes) {
  if (!scratchHeld) { scratchHeld = true; queueMicrotask(releaseScratch) }
  const held = scratchRasters[kind]
  if (held?.canvas.width === width && held.canvas.height === height && typeof held.context?.reset === 'function') {
    held.context.reset()
    return held
  }
  const canvas = Object.assign(document.createElement('canvas'), { width, height })
  return scratchRasters[kind] = { canvas, context:canvas.getContext('2d', attributes) }
}
function releaseScratch() {
  scratchHeld = false
  for (const kind of Object.keys(scratchRasters)) delete scratchRasters[kind]
}

const host = {
  scratch: scratchRaster, author: normalizeBookAuthor, spineFinish, cloth: replayCloth,
  surface: value => SURFACE_FINISHES[surfaceFinish(value, 'matte')],
  three: THREE, weavePixels: () => rustBookWeavePixels(getRustCore()), tiles: null,
  // The spine's relief as the binding samples it: the mesh reads `pixels` (256 x 1024 RGBA) in one pass.
  bindingRelief: pixels => Object.assign((u, v) => pixels[needRustShelf().book_mesh_relief_index(u, v, 256, 1024)] / 255, { pixels })
}

// Colour and PBR channels share exactly the same glyph raster. Text never
// becomes a floating decal: it follows the continuous curved binding UVs.
// level: 'detail' (lifted book: height channel drives a bump map), 'shelf'
// or 'overview' (tiny). No level reads pixels back except engraved relief.
export function spineSurface(book, style, physicalHeight, thickness, options) {
  return needRustShelf().spine_surface(book, style, physicalHeight, thickness, options, host)
}

export function releaseSurface(surface) { surface.map.dispose(); surface.channels.dispose() }
