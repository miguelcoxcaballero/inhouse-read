import * as THREE from 'three'
import { spineFinish, surfaceFinish, SURFACE_FINISHES } from './book-colors.js'
import { normalizeBookAuthor } from './book-title.js'

// Hot-foil leaf: a soft studio band across the curved spine. The metal
// channel still lets the environment move the real highlight as it turns.
const FOIL = {
  gold: [[0,'#9c772c'],[.16,'#cfab58'],[.32,'#f0d994'],[.45,'#c29944'],[.6,'#e4c880'],[.8,'#ad8437'],[1,'#8f6c29']],
  silver: [[0,'#858d96'],[.16,'#c1c7cd'],[.32,'#edf0f3'],[.45,'#a4abb3'],[.6,'#d8dce1'],[.8,'#959ca5'],[1,'#7e858e']]
}
// Design units: 1024 is the full spine height (head at 0).
const BAND_HALF = 7.5, SURFACE = 200, RIDGE = 255, BLIND = 150

/** Every publisher sets its spines a little differently: raised bands between
 * heavy and fine rules, fine double rules, a blind-stamped panel, or a plain
 * spine with a device at the tail. The case follows the book (id and title),
 * never its colour, so recolouring keeps the same binding. */
export function spineLayout(book) {
  const pick = seededRandom(textSeed(`layout|${book?.id ?? ''}|${book?.title ?? ''}`))
  const kind = ['banded', 'ruled', 'panel', 'plain'][Math.floor(pick() * 4)], s = Math.floor(pick() * 4) * 6
  if (kind === 'banded') return { kind, bands:[64 + s, 960 - s],
    rules:[[48 + s, 2.3], [79.5 + s, 1.1], [944.5 - s, 1.1], [976 - s, 2.3]], span:[102 + s, 922 - s] }
  if (kind === 'ruled') return { kind, bands:[], footAuthor:true,
    rules:[[40 + s, 1.3], [47 + s, 1.3], [977 - s, 1.3], [984 - s, 1.3]], span:[78 + s, 946 - s] }
  if (kind === 'panel') return { kind, bands:[], panel:[92 + s / 2, 932 - s / 2],
    rules:[[38, 2.6], [986, 2.6]], span:[124 + s / 2, 900 - s / 2] }
  return { kind, bands:[], device:Math.floor(pick() * 3), deviceAt:904 - s / 2,
    rules:[[52 + s / 2, 1.1], [972 - s / 2, 1.1]], span:[86 + s / 2, 852 - s / 2] }
}

// A small printer's device, centred on (0, 0) in design units.
export function drawDevice(c, kind, size) {
  if (kind === 0) {
    // Lozenge between two short rules.
    c.save(); c.rotate(Math.PI / 4); c.fillRect(-size * .32, -size * .32, size * .64, size * .64); c.restore()
    c.fillRect(-size * 1.35, -size * .06, size * .75, size * .12); c.fillRect(size * .6, -size * .06, size * .75, size * .12)
  } else if (kind === 1) {
    // Ring with a dot: a colophon.
    c.beginPath(); c.arc(0, 0, size * .62, 0, Math.PI * 2); c.arc(0, 0, size * .47, 0, Math.PI * 2, true); c.fill()
    c.beginPath(); c.arc(0, 0, size * .16, 0, Math.PI * 2); c.fill()
  } else {
    // Three dots, as a printer's mark.
    for (const [x, y] of [[0, -size * .34], [-size * .36, size * .26], [size * .36, size * .26]]) {
      c.beginPath(); c.arc(x, y, size * .15, 0, Math.PI * 2); c.fill()
    }
  }
}

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
export function seededRandom(seed) {
  let s = seed >>> 0 || 1
  return () => {
    s = s + 0x6D2B79F5 | 0
    let t = Math.imul(s ^ s >>> 15, 1 | s)
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t
    return ((t ^ t >>> 14) >>> 0) / 4294967296
  }
}

/** Attach colour stops; tolerant of partial canvas implementations. */
export function withStops(gradient, stops) {
  for (const [at, value] of stops) gradient?.addColorStop?.(at, value)
  return gradient
}

function foilGradient(context, width, finish) {
  return withStops(context.createLinearGradient(0, 0, width, 0), FOIL[finish] || FOIL.gold)
}

/** Low-frequency variation from a tiny random raster, upscaled in one pass.
 * soft-light around mid-grey mottles colour; 'lighter' with a single channel
 * adds to one PBR channel. Far cheaper than stacking large radial gradients. */
export function paintField(c, width, height, random, { operation = 'soft-light', spread = 40, channel = null, cells = [9, 30] } = {}) {
  const field = Object.assign(document.createElement('canvas'), { width:cells[0], height:cells[1] })
  // One pixel write for the whole field; per-cell fillRect parsed hundreds
  // of colour strings for every book.
  const f = field.getContext('2d'), image = f.createImageData?.(cells[0], cells[1]), data = image?.data
  for (let i = 0; i < cells[0] * cells[1]; i++) {
    const v = channel ? Math.round(random() * spread) : Math.round(128 + (random() - .5) * 2 * spread)
    if (data) { data[i * 4] = data[i * 4 + 2] = channel ? 0 : v; data[i * 4 + 1] = v; data[i * 4 + 3] = 255 }
  }
  if (data) f.putImageData(image, 0, 0)
  c.save(); c.globalCompositeOperation = operation; c.imageSmoothingEnabled = true
  c.imageSmoothingQuality = 'high'; c.drawImage(field, 0, 0, width, height); c.restore()
}

// Book cloth: slow dye mottling plus irregular warp/weft slubs. Mipmaps turn
// the threads into a quiet tooth on the shelf and a real weave up close.
export function paintCloth(c, designWidth, random, { threads = true, metal = false } = {}) {
  // A thumbnail shows neither dye nor threads: keep its flat colour.
  if (!threads) return
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

// Plain weave, 16 × 16 threads per 128 px tile with uneven yarn (a small tile
// repeated reads as a screen). Cover and lifted spine share one pitch, 4.4
// design units a thread (1024 = board height), so one case is one cloth.
export const WEAVE = 4.4 / 8
let weaveTiles = null
function weaveTile(kind) {
  if (!weaveTiles) {
    weaveTiles = {}
    const shade = new Float32Array(64 * 64)
    for (let y = 0; y < 128; y += 2) for (let x = 0; x < 128; x += 2) {
      const i = x >> 3, j = y >> 3, warp = (i + j) % 2
      const lift = warp ? Math.sin(Math.PI * (x % 8 + 1) / 8) : Math.sin(Math.PI * (y % 8 + 1) / 8)
      const yarn = warp ? lattice(i, y >> 4, 3) : lattice(j, x >> 4, 4)
      shade[(y >> 1) * 64 + (x >> 1)] = (lift - .62) * (.6 + yarn * .8) + (lattice(i, j, 5) - .5) * .25
    }
    for (const name of ['color', 'channels']) {
      const canvas = Object.assign(document.createElement('canvas'), { width:128, height:128 })
      const t = canvas.getContext('2d'), image = t?.createImageData?.(128, 128), data = image?.data
      if (data) {
        for (let p = 0; p < 128 * 128; p++) {
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

// Baked shading only for features fixed to the book: band ridges, a blind
// panel, the joint creases beside both boards and the rubbed head and tail.
function paintRelief(c, designWidth, random, layout, { wear = true } = {}) {
  for (const y of layout.bands) {
    c.fillStyle = withStops(c.createLinearGradient(0, y - BAND_HALF - 2, 0, y + BAND_HALF + 3), [
      [0, 'rgba(0,0,0,0)'], [.1, 'rgba(255,250,240,.2)'], [.42, 'rgba(255,250,240,.08)'],
      [.62, 'rgba(0,0,0,.1)'], [.9, 'rgba(0,0,0,.3)'], [1, 'rgba(0,0,0,0)']])
    c.fillRect(0, y - BAND_HALF - 2, designWidth, BAND_HALF * 2 + 5)
  }
  if (layout.panel) {
    // Blind tooling: the pressed line's far wall is lit, its floor in shade.
    const [top, bottom] = layout.panel, x = designWidth * .17, w = designWidth * .66
    c.lineWidth = 2.2; c.strokeStyle = 'rgba(0,0,0,.24)'; c.strokeRect(x, top, w, bottom - top)
    c.lineWidth = 1; c.strokeStyle = 'rgba(255,250,240,.12)'; c.strokeRect(x + 1.6, top + 1.6, w, bottom - top)
  }
  const joint = designWidth * .085
  for (const [from, to] of [[0, joint], [designWidth, designWidth - joint]]) {
    c.fillStyle = withStops(c.createLinearGradient(from, 0, to, 0),
      [[0, 'rgba(0,0,0,.26)'], [.4, 'rgba(0,0,0,.08)'], [1, 'rgba(0,0,0,0)']])
    c.fillRect(Math.min(from, to), 0, joint, 1024)
  }
  for (const [from, to] of [[0, 16], [1024, 1008]]) {
    c.fillStyle = withStops(c.createLinearGradient(0, from, 0, to),
      [[0, 'rgba(0,0,0,.34)'], [.35, 'rgba(0,0,0,.12)'], [1, 'rgba(0,0,0,0)']])
    c.fillRect(0, Math.min(from, to), designWidth, 16)
    // Rubbed cloth at the very edge shows paler fibres in short patches.
    if (wear) for (let x = 0; x < designWidth;) {
      const length = 4 + random() * 22
      c.fillStyle = `rgba(255,246,228,${random() * .16})`
      c.fillRect(x, from ? 1021.2 : 0, length, 2.8); x += length
    }
  }
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

// Colour and PBR channels share exactly the same glyph raster. Text never
// becomes a floating decal: it follows the continuous curved binding UVs.
// level: 'detail' (lifted book: height channel drives a bump map), 'shelf'
// or 'overview' (tiny). No level reads pixels back except engraved relief.
export function spineSurface(book, style, physicalHeight = 200, thickness = 32,
  { textureWidth = 512, textureHeight = 2048, engraving = true, level = 'detail' } = {}) {
  const width = Math.max(1, Math.round(Number(textureWidth) || 512))
  const height = Math.max(1, Math.round(Number(textureHeight) || 2048))
  const canvas = () => Object.assign(document.createElement('canvas'), { width, height })
  const designWidth = Math.max(80, thickness / physicalHeight * 1024 * Math.PI / 2)
  const toDesign = context => context.setTransform?.(width / designWidth, 0, 0, height / 1024, 0, 0)
  const engraved = engraving && book.spineEngraved === true
  // Relief is sampled on the CPU: keep that raster off the GPU so reading it
  // back does not stall on a full GPU flush (seconds on software renderers).
  const { canvas:mask, context:c } = scratchRaster(engraved ? 'relief-mask' : 'mask', width, height, engraved ? { willReadFrequently:true } : undefined)
  toDesign(c); c.fillStyle = '#fff'; c.textAlign = 'center'; c.textBaseline = 'middle'
  const layout = spineLayout(book), [top, bottom] = layout.span
  const family = `"${style.fontCanvasFamily || style.fontFamily || 'Playfair Display'}", ${style.fontFallback || 'Georgia, serif'}`
  let size = Math.min(designWidth * .9, 64 * (Number(style.spineFontSize) || 10) / 10)
  let title = String(book.spineTitleOverride || book.title || 'Sin título')
  const author = Number(style.width) >= 32 && normalizeBookAuthor(book.author)
  const authorSize = author
    ? Math.min(designWidth * .82, 28 * (Number(style.spineAuthorFontSize) || 12) / 12)
    : 0
  const setFont = () => { c.font = `${style.fontWeight || 700} ${size}px ${family}` }
  const setAuthorFont = () => { c.font = `500 ${authorSize}px "DM Sans", sans-serif` }
  // Fit by font size, never by non-uniform fillText(maxWidth) compression.
  const fit = limit => {
    setFont()
    while (c.measureText(title).width > limit && size > 44) { size -= 1; setFont() }
    return c.measureText(title).width <= limit
  }
  // Ruled cases set a short author at the foot, in line with the title,
  // whenever both fit without shrinking the title below its minimum.
  let foot = 0
  if (author && layout.footAuthor) {
    const initial = size; setAuthorFont()
    const name = c.measureText(author).width
    if (name <= Math.min(300, (bottom - top) * .36) && fit(bottom - top - name - 48)) foot = name
    else size = initial
  }
  const length = foot ? bottom - top - foot - 48 : bottom - top
  if (!fit(length)) {
    while (title.length > 1 && c.measureText(title + '…').width > length) title = title.slice(0, -1)
    title = title.trimEnd() + '…'
  }
  // Text runs head to tail: x along the spine, y across it.
  c.save(); c.translate(designWidth / 2, 0); c.rotate(Math.PI / 2)
  if (foot) {
    c.fillText(title, top + length / 2, 0)
    setAuthorFont(); c.fillText(author, bottom - foot / 2, 0)
  } else {
    // Title and author are parallel on the curved spine. Position them as one
    // compact group, centered across its width, instead of pinning them to
    // opposite edges and leaving a large empty band between the two.
    const center = (top + bottom) / 2, labelGap = author ? Math.max(1.5, Math.min(3, size * .045)) : 0
    c.fillText(title, center, author ? -(authorSize + labelGap) / 2 : 0)
    if (author) {
      setAuthorFont()
      let name = author
      while (name.length > 1 && c.measureText(name).width > length - 60) name = name.slice(0, -1)
      c.fillText(name, center, (size + labelGap) / 2)
    }
  }
  c.restore()
  // Stamped rules stop short of the joints, like a real brass tool.
  for (const [y, weight] of layout.rules) c.fillRect(designWidth * .13, y - weight / 2, designWidth * .74, weight)
  if (layout.device !== undefined) {
    c.save(); c.translate(designWidth / 2, layout.deviceAt)
    drawDevice(c, layout.device, Math.min(designWidth * .24, 26)); c.restore()
  }

  const bindingFinish = spineFinish(book.spineFinish), textFinish = spineFinish(book.spineTextFinish)
  const metalBinding = bindingFinish !== 'matte', metalText = textFinish !== 'matte'
  const random = seededRandom(textSeed(`${book.id ?? ''}|${book.title ?? ''}|${style.color}`))
  const color = canvas(), ctx = color.getContext('2d')
  ctx.fillStyle = metalBinding ? foilGradient(ctx, width, bindingFinish) : style.color
  ctx.fillRect(0, 0, width, height)
  toDesign(ctx)
  const thumb = level === 'overview', woven = level === 'detail' && !metalBinding
  paintCloth(ctx, designWidth, random, { threads:!thumb, metal:metalBinding })
  // Close up the spine is the same woven cloth as the cover beside it.
  if (woven) paintWeave(ctx, designWidth)
  paintRelief(ctx, designWidth, random, layout, { wear:!thumb })
  ctx.setTransform?.(1, 0, 0, 1, 0, 0)
  const { canvas:ink, context:ic } = scratchRaster('ink', width, height)
  // Tint the glyph mask (optionally only the strip a shifted copy leaves
  // uncovered, i.e. one wall of each stroke) and lay it on the cloth.
  const stamp = (fill, offset = 0) => {
    ic.globalCompositeOperation = 'source-over'; ic.clearRect(0, 0, width, height); ic.drawImage(mask, 0, 0)
    if (offset) { ic.globalCompositeOperation = 'destination-out'; ic.drawImage(mask, 0, offset) }
    ic.globalCompositeOperation = 'source-in'; ic.fillStyle = fill; ic.fillRect(0, 0, width, height)
    ctx.drawImage(ink, 0, 0)
  }
  stamp(metalText ? foilGradient(ic, width, textFinish) : style.ink)
  if (engraved) {
    // Debossed walls: the upper wall of each stroke falls into shadow, the
    // lower one catches the shelf light. Visible even at shelf mip levels.
    const step = Math.max(1, height / 1024 * 1.8)
    stamp('rgba(0,0,0,.5)', step); stamp('rgba(255,250,236,.24)', -step)
  }

  // R = surface height, G = roughness, B = metalness. Linear, never sRGB.
  const packed = canvas(), pc = packed.getContext('2d')
  const surface = SURFACE_FINISHES[surfaceFinish(book.spineSurfaceFinish, 'matte')]
  const bindingRoughness = Math.round(surface.roughness * 255), metal = metalBinding ? 255 : 0
  const base = `rgb(${SURFACE},${Math.max(0, bindingRoughness - 12)},${metal})`
  pc.fillStyle = base; pc.fillRect(0, 0, width, height)
  toDesign(pc)
  // Dye and handling leave the cloth unevenly burnished: roughness mottling.
  // Foil is near-mirror: any mottle there reads as hammered metal.
  if (!metalBinding && !thumb) paintField(pc, designWidth, 1024, random, { operation:'lighter', spread:24, channel:'g', cells:[7, 24] })
  const ridge = h => `rgb(${h},${bindingRoughness},${metal})`
  for (const y of layout.bands) {
    pc.fillStyle = withStops(pc.createLinearGradient(0, y - BAND_HALF, 0, y + BAND_HALF),
      [[0, ridge(SURFACE)], [.4, ridge(RIDGE)], [.6, ridge(RIDGE)], [1, ridge(SURFACE)]])
    pc.fillRect(0, y - BAND_HALF, designWidth, BAND_HALF * 2)
  }
  if (layout.panel) {
    const [top, bottom] = layout.panel
    pc.lineWidth = 2.2; pc.strokeStyle = ridge(BLIND)
    pc.strokeRect(designWidth * .17, top, designWidth * .66, bottom - top)
  }
  pc.setTransform?.(1, 0, 0, 1, 0, 0)
  ic.globalCompositeOperation = 'source-over'; ic.clearRect(0, 0, width, height)
  ic.drawImage(mask, 0, 0); ic.globalCompositeOperation = 'source-in'
  // Foil is always pressed slightly into the cloth; "grabado" goes deep.
  const letterHeight = engraved ? 110 : metalText ? 184 : SURFACE
  ic.fillStyle = `rgb(${letterHeight},${metalText ? 66 : 230},${metalText ? 255 : 0})`
  ic.fillRect(0, 0, width, height); pc.drawImage(ink, 0, 0)
  // The threads show mostly as relief and burnish, not as a printed grid.
  if (woven) { toDesign(pc); paintWeave(pc, designWidth, { channels:true }) }
  const map = new THREE.CanvasTexture(color); map.colorSpace = THREE.SRGBColorSpace
  const channels = new THREE.CanvasTexture(packed)
  // three's bump is screen-space: a close-up band spans many pixels and needs
  // a large scale; shelf copies keep the tiny legacy value for engraving only.
  const bump = level === 'detail' ? 2.6 : engraved ? .035 : 0
  let relief = null
  if (engraved) {
    const { context:sc } = scratchRaster('relief-sample', 256, 1024, { willReadFrequently:true })
    sc.filter = 'blur(1.2px)'; sc.drawImage(mask, 0, 0, 256, 1024)
    const pixels = sc.getImageData(0, 0, 256, 1024).data
    relief = (u,v) => pixels[(Math.min(1023, Math.floor((1-v)*1024))*256 + Math.min(255, Math.floor(u*256)))*4+3]/255
  }
  const metallic = metalBinding || metalText
  // Cloth scatters a soft rim of light at grazing angles; foil does not. A
  // shelf spine is a few dozen pixels wide: the sheen lobe is invisible there
  // but costs its BRDF and image-based term on every pixel of every repaint.
  const sheen = metalBinding || level !== 'detail' ? 0 : .55
  return { map, channels, relief, material:{
    map, roughness:1, metalness:1, roughnessMap:channels, metalnessMap:channels,
    bumpMap:bump ? channels : null, bumpScale:bump,
    sheen, sheenRoughness:.62, sheenColor:new THREE.Color(style.color).lerp(new THREE.Color('#fff4e6'), .45),
    envMapIntensity:surface.envMapIntensity * (metallic ? 1.2 : .9),
    anisotropy:metallic ? .35 : 0,
    clearcoat:surface.clearcoat,
    clearcoatRoughness:surface.clearcoatRoughness
  } }
}

export function releaseSurface(surface) { surface.map.dispose(); surface.channels.dispose() }
