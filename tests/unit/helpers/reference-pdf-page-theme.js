// Frozen original of src/js/readers/pdf-page-theme.js before its painting moved to Rust (tests only).
import { pdfImagePaths } from '../../../src/js/readers/pdf-images-wasm.js'

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
  // Three adjacent corners define the fourth, and reflected images get the same
  // winding as ordinary ones, so overlapping paths cannot cancel and recolour
  // that area. A rectangular bounding box would restore white wedges around
  // rotated photographs in night mode.
  const paths = pdfImagePaths(coordinates, target.width, target.height)
  ctx.save()
  ctx.beginPath()
  for (let i = 0; i < paths.length; i += 8) {
    ctx.moveTo(paths[i], paths[i + 1])
    ctx.lineTo(paths[i + 2], paths[i + 3])
    ctx.lineTo(paths[i + 4], paths[i + 5])
    ctx.lineTo(paths[i + 6], paths[i + 7])
    ctx.closePath()
  }
  ctx.clip()
  ctx.drawImage(source, 0, 0, target.width, target.height)
  ctx.restore()
}

// Stencil masks still bypass PDF.js's image-footprint tracker. Preserve their
// original printed page rather than guess bounds. The guarded Vite patch now
// records grouped/repeated ordinary images at every actual draw transform.
export function hasUntrackedPDFImages(operatorList, ops) {
  const names = ['paintImageMaskXObject', 'paintImageMaskXObjectGroup', 'paintImageMaskXObjectRepeat', 'paintSolidColorImageMask']
  const untracked = new Set(names.map(name => ops?.[name]).filter(Number.isFinite))
  return operatorList?.fnArray?.some(op => untracked.has(op)) || false
}
