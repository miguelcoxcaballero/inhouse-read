// Frozen book cloth painter before Rust planning.
export function seededRandom(seed) {
  let s = seed >>> 0 || 1
  return () => {
    s = s + 0x6D2B79F5 | 0
    let t = Math.imul(s ^ s >>> 15, 1 | s)
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t
    return ((t ^ t >>> 14) >>> 0) / 4294967296
  }
}

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

