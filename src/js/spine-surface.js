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
export const lattice = (i, j, salt) => {
  let h = Math.imul(i * 374761393 + j * 668265263 + salt * 1442695041 | 0, 1274126177)
  h = Math.imul(h ^ h >>> 13, 1103515245)
  return ((h ^ h >>> 16) >>> 0) / 4294967296
}

export function textSeed(text) {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619)
  return h >>> 0
}
/** Small deterministic PRNG: the same book always gets the same cloth. */
const randomStates = new WeakMap()
export function seededRandom(seed) {
  let s = seed >>> 0 || 1
  const random = () => {
    s = s + 0x6D2B79F5 | 0
    let t = Math.imul(s ^ s >>> 15, 1 | s)
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t
    return ((t ^ t >>> 14) >>> 0) / 4294967296
  }
  randomStates.set(random, { get: () => s, set: value => { s = value | 0 } })
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
export const paintField = (c, width, height, random, options) => needRustShelf().paint_field(c, width, height, random, options)

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
  // Dye variation in real cloth is a few percent at most; more reads as camouflage.
  paintField(c, designWidth, 1024, random, { operation:'soft-light', spread:metal ? 5 : 9,
    cells:[Math.max(4, Math.round(designWidth / 34)), 30] })
  for (let i = 0; i < (metal ? 40 : 110); i++) {
    const y = random() * 1024, x = random() * designWidth * .7, length = designWidth * (.2 + random() * .6)
    c.fillStyle = random() > .45 ? `rgba(255,248,235,${.012 + random() * .03})` : `rgba(0,0,0,${.015 + random() * .035})`
    c.fillRect(x, y, length, .5 + random() * .8)
  }
  if (metal) return
  for (let i = 0; i < 26; i++) {
    const x = random() * designWidth, y = random() * 900, length = 60 + random() * 380
    c.fillStyle = random() > .5 ? `rgba(255,248,235,${.012 + random() * .025})` : `rgba(0,0,0,${.015 + random() * .03})`
    c.fillRect(x, y, .5 + random() * .7, length)
  }
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
    const shade = pixels ? null : new Float32Array(64 * 64)
    if (!pixels) for (let y = 0; y < 128; y += 2) for (let x = 0; x < 128; x += 2) {
      const i = x >> 3, j = y >> 3, warp = (i + j) % 2
      const lift = warp ? Math.sin(Math.PI * (x % 8 + 1) / 8) : Math.sin(Math.PI * (y % 8 + 1) / 8)
      const yarn = warp ? lattice(i, y >> 4, 3) : lattice(j, x >> 4, 4)
      shade[(y >> 1) * 64 + (x >> 1)] = (lift - .62) * (.6 + yarn * .8) + (lattice(i, j, 5) - .5) * .25
    }
    for (const name of ['color', 'channels']) {
      const canvas = Object.assign(document.createElement('canvas'), { width:128, height:128 })
      const t = canvas.getContext('2d'), image = t?.createImageData?.(128, 128), data = image?.data
      if (data) {
        if (pixels) data.set(pixels[name])
        else for (let p = 0; p < 128 * 128; p++) {
          const s = shade[(p >> 8) * 64 + ((p & 127) >> 1)], k = p * 4
          if (name === 'color') {
            // Shadowed gaps carry the weave; a bright dot at every crossing
            // read as a screen door on phones, so the crowns barely lighten.
            data.set(s > 0 ? [255, 248, 236, Math.round(s * .035 * 255)] : [0, 0, 0, Math.round(-s * .075 * 255)], k)
          } else {
            // Multiplied into R height / G roughness: gaps sink, crowns are
            // burnished smoother, metalness (B) is untouched.
            data.set([Math.round(255 * (1 - Math.max(0, -s) * .16)), Math.round(255 * (1 - Math.max(0, s) * .2)), 255, 255], k)
          }
        }
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
  scratch: scratchRaster, author: normalizeBookAuthor, spineFinish, random: seededRandom, paintCloth, paintWeave,
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
  const relief = pixels ? (u,v) => pixels[(Math.min(1023, Math.floor((1-v)*1024))*256 + Math.min(255, Math.floor(u*256)))*4+3]/255 : null
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
