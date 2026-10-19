import { createBindingRelief } from './binding-wasm.js'
import { getRustCore } from './rust-core.js'
import { rustBookWeavePixels, rustBookClothPlan } from './book-surface-wasm.js'
import * as THREE from 'three'
import { spineFinish, surfaceFinish, SURFACE_FINISHES } from './book-colors.js'
import { normalizeBookAuthor } from './book-title.js'
import { needRustShelf } from './rust-shelf.js'

// The binding layout, the lettering fit and every canvas operation of a spine run in Rust
// (rust-ui/src/spine_surface.rs, the `shelf` module the first shelf render awaits). What stays
// here is the part that touches three.js, the pooled scratch canvases, the pseudo-random streams
// that the cloth plan resumes, and the cloth/weave painters that replay the core's plans.

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

// Only the callback/cursor lives in JS. Rust generates 64 exact PRNG values
// per call; the consumed state is retained when a cloth plan takes over.
const randomStates = new WeakMap()
export function seededRandom(seed) {
  let state = needRustShelf().spine_random_seed(seed), batch = null, cursor = 0
  const random = () => {
    if (!batch || cursor === batch.length) { batch = needRustShelf().spine_random_batch(state); cursor = 0 }
    state = batch[cursor++]; return batch[cursor++]
  }
  randomStates.set(random, { get: () => state, set: value => { state = value; batch = null; cursor = 0 } })
  return random
}

/** Attach colour stops; tolerant of partial canvas implementations. */
export function withStops(gradient, stops) {
  for (const [at, value] of stops) gradient?.addColorStop?.(at, value)
  return gradient
}

/** Low-frequency variation from a tiny random raster, upscaled in one pass.
 * soft-light around mid-grey mottles colour; 'lighter' with a single channel
 * adds to one PBR channel. Far cheaper than stacking large radial gradients. */
export function paintField(c, width, height, random, options) {
  const stream = randomStates.get(random), rust = needRustShelf()
  if (stream) {
    const [state, ok, error] = rust.paint_field_seeded(c, width, height, stream.get(), options)
    stream.set(state); if (!ok) throw error
  }
  else rust.paint_field(c, width, height, random, options)
}

// Book cloth: slow dye mottling plus irregular warp/weft slubs. Mipmaps turn
// the threads into a quiet tooth on the shelf and a real weave up close.
export function paintCloth(c, designWidth, random, { threads = true, metal = false } = {}) {
  // A thumbnail shows neither dye nor threads: keep its flat colour.
  if (!threads) return
  const stream = randomStates.get(random)
  const plan = stream && rustBookClothPlan(getRustCore(), stream.get(), designWidth, metal)
  if (plan) {
    stream.set(plan.state)
    paintClothPlan(c, designWidth, plan)
    return
  }
  needRustShelf().paint_cloth_callback(c, designWidth, random, metal)
}

// Replay the same Canvas operations after the numeric plan has been copied.
// No WebAssembly view or live arena is held while Canvas paints the book.
function paintClothPlan(c, designWidth, plan) {
  const field = Object.assign(document.createElement('canvas'), { width:plan.fieldWidth, height:30 })
  const f = field.getContext('2d'), image = f.createImageData?.(plan.fieldWidth, 30)
  if (image?.data) { image.data.set(plan.pixels); f.putImageData(image, 0, 0) }
  c.save(); c.globalCompositeOperation = 'soft-light'; c.imageSmoothingEnabled = true
  c.imageSmoothingQuality = 'high'; c.drawImage(field, 0, 0, designWidth, 1024); c.restore()
  const commands = plan.commands
  for (let at = 0; at < commands.length; at += 6) {
    c.fillStyle = commands[at + 5] ? `rgba(255,248,235,${commands[at + 4]})` : `rgba(0,0,0,${commands[at + 4]})`
    c.fillRect(commands[at], commands[at + 1], commands[at + 2], commands[at + 3])
  }
}

// Plain weave, 16 × 16 threads per 128 px tile with uneven yarn (a small tile
// repeated reads as a screen). Cover and lifted spine share one pitch, 4.4
// design units a thread (1024 = board height), so one case is one cloth.
export const WEAVE = 4.4 / 8
let weaveTiles = null
function weaveTile(kind) {
  if (!weaveTiles) {
    weaveTiles = {}
    const pixels = rustBookWeavePixels(getRustCore())
    if (!pixels) { weaveTiles = null; throw new Error('No se pudo generar el tejido del libro en Rust.') }
    for (const name of ['color', 'channels']) {
      const canvas = Object.assign(document.createElement('canvas'), { width:128, height:128 })
      const t = canvas.getContext('2d'), image = t?.createImageData?.(128, 128), data = image?.data
      if (data) {
        data.set(pixels[name])
        t.putImageData(image, 0, 0)
      }
      weaveTiles[name] = canvas
    }
  }
  return weaveTiles[kind]
}
/** Lay the weave over a canvas drawn in design units: colour by default, or
 * multiplied into a packed height/roughness/metal channel raster. */
export function paintWeave(c, designWidth, { channels = false } = {}) {
  const pattern = c.createPattern?.(weaveTile(channels ? 'channels' : 'color'), 'repeat')
  if (!pattern) return
  c.save(); if (channels) c.globalCompositeOperation = 'multiply'
  c.scale(WEAVE, WEAVE); c.fillStyle = pattern; c.fillRect(0, 0, designWidth / WEAVE, 1024 / WEAVE); c.restore()
}

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
  scratch: scratchRaster, author: normalizeBookAuthor, spineFinish, random: seededRandom, paintCloth, paintWeave, paintField,
  surface: value => SURFACE_FINISHES[surfaceFinish(value, 'matte')]
}

// Colour and PBR channels share exactly the same glyph raster. Text never
// becomes a floating decal: it follows the continuous curved binding UVs.
// level: 'detail' (lifted book: height channel drives a bump map), 'shelf'
// or 'overview' (tiny). No level reads pixels back except engraved relief.
export function spineSurface(book, style, physicalHeight, thickness, options) {
  const raw = needRustShelf().spine_surface(book, style, physicalHeight, thickness, options, host)
  const map = new THREE.CanvasTexture(raw.color); map.colorSpace = THREE.SRGBColorSpace
  const channels = new THREE.CanvasTexture(raw.packed)
  const pixels = raw.relief
  const relief = pixels ? createBindingRelief(getRustCore(), pixels) : null
  return { map, channels, relief, material:{
    map, roughness:1, metalness:1, roughnessMap:channels, metalnessMap:channels,
    bumpMap:raw.bump ? channels : null, bumpScale:raw.bump,
    sheen:raw.sheen, sheenRoughness:.62, sheenColor:new THREE.Color(style.color).lerp(new THREE.Color('#fff4e6'), .45),
    envMapIntensity:raw.envMapIntensity,
    anisotropy:raw.anisotropy,
    clearcoat:raw.clearcoat,
    clearcoatRoughness:raw.clearcoatRoughness
  } }
}

export function releaseSurface(surface) { surface.map.dispose(); surface.channels.dispose() }
