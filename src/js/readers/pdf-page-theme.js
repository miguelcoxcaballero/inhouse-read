// PDF.js reports image footprints in normalized page coordinates. Theme the
// printed paper/ink once, then copy the ORIGINAL pixels inside each footprint.
// No pixel readback or CPU loop is needed, including for monochrome photos.
export function paintPDFTheme(source, target, filter, coordinates = []) {
  const ctx = target.getContext('2d')
  ctx.clearRect(0, 0, target.width, target.height)
  ctx.filter = filter
  ctx.drawImage(source, 0, 0, target.width, target.height)
  ctx.filter = 'none'
  if (filter === 'none' || !coordinates.length) return
  ctx.save()
  ctx.beginPath()
  for (let i = 0; i + 5 < coordinates.length; i += 6) {
    const [ax, ay, bx, by, cx, cy] = Array.from(coordinates.slice(i, i + 6))
    if (![ax, ay, bx, by, cx, cy].every(Number.isFinite)) continue
    // Three adjacent corners define the fourth. A rectangular bounding box
    // would restore white wedges around rotated photographs in night mode.
    // Give reflected images the same winding as ordinary images: opposite
    // paths would otherwise cancel in an overlap and recolour that area.
    const mirrored = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax) < 0
    ctx.moveTo(ax * target.width, ay * target.height)
    ctx.lineTo((mirrored ? cx : bx) * target.width, (mirrored ? cy : by) * target.height)
    ctx.lineTo((bx + cx - ax) * target.width, (by + cy - ay) * target.height)
    ctx.lineTo((mirrored ? bx : cx) * target.width, (mirrored ? by : cy) * target.height)
    ctx.closePath()
  }
  ctx.clip()
  ctx.drawImage(source, 0, 0, target.width, target.height)
  ctx.restore()
}

// These batched operators bypass PDF.js's image-footprint tracker. Preserve
// the original printed page for such layouts rather than recolour an image
// using guessed bounds. Ordinary XObjects and inline images are tracked.
export function hasUntrackedPDFImages(operatorList, ops) {
  const names = ['paintInlineImageXObjectGroup', 'paintImageXObjectRepeat',
    'paintImageMaskXObject', 'paintImageMaskXObjectGroup', 'paintImageMaskXObjectRepeat', 'paintSolidColorImageMask']
  const untracked = new Set(names.map(name => ops?.[name]).filter(Number.isFinite))
  return operatorList?.fnArray?.some(op => untracked.has(op)) || false
}
