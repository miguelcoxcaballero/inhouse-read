import { normalizeBookAuthor } from './book-title.js'
import { normalizeCoverRelief } from './cover-relief.js'
import { core, tables, inArena, f64View, writeUnits } from './catalogue-core.js'
const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

// Hex parsing, the book cloths and the legible ink are the Rust core's
// (rust-core/src/book_colors.rs): the text goes in as UTF-16, `#rrggbb` comes out.
function hexes(kernel, value, count) {
  const text = String(value ?? '')
  return inArena([3, Math.ceil(text.length / 4)], (pointer, at) => {
    const length = writeUnits(pointer, at[1], text)
    if (kernel(pointer + at[1] * 8, length, pointer) !== 1) return null
    const bytes = new Uint8Array(core.memory.buffer, pointer, count * 7)
    return Array.from({ length: count }, (_, index) => String.fromCharCode(...bytes.subarray(index * 7, index * 7 + 7)))
  })
}
const normalizedHex = value => hexes(core.color_hex, value, 1)?.[0] ?? null

/** The cover colour plus two split-complementary cloths; neutral covers get oxblood and navy. */
export const bookColorOptions = coverColor => hexes(core.book_color_options, coverColor, 3)

export const METAL_COLORS = { ...tables.metalColors }
export function spineFinish(value) { return ['gold','silver'].includes(value) ? value : 'matte' }

export const SURFACE_FINISHES = Object.freeze(Object.fromEntries(Object.entries(tables.surfaceFinishes)
  .map(([name, finish]) => [name, Object.freeze(finish)])))
export function surfaceFinish(value, fallback = 'satin') {
  if (typeof value === 'string' && Object.hasOwn(SURFACE_FINISHES, value)) return value
  return typeof fallback === 'string' && Object.hasOwn(SURFACE_FINISHES, fallback) ? fallback : 'satin'
}

/** Derive spine shading and legible title ink for any user-selected color. */
export function spineColorStyle(color) {
  const [colour, shade, ink] = hexes(core.spine_color_style, color, 3)
  return { color: colour, shade, ink }
}

/** Portable shelf coordinates: shelf index and horizontal fraction of a row. */
export function normalizeShelfPosition(value) {
  if (!value || !Number.isSafeInteger(value.shelf) || value.shelf < 0 || !Number.isFinite(value.x)) return null
  return { shelf:value.shelf, x:clamp(value.x,0,1) }
}

/** Explicit allow-list for saved appearance, including resets to automatic. */
export function spineCustomization(book) {
  const result = {}
  if (book?.shelfPosition === null) result.shelfPosition = null
  else {
    const position = normalizeShelfPosition(book?.shelfPosition)
    if (position) result.shelfPosition = position
  }
  for (const key of ['spineColorOverride','spineTextColor']) {
    if (book?.[key] === null) result[key] = null
    else if (normalizedHex(book?.[key])) result[key] = normalizedHex(book[key])
  }
  for (const key of ['spineFinish','spineTextFinish']) if (key in (book || {})) result[key] = spineFinish(book[key])
  if ('coverFinish' in (book || {})) result.coverFinish = surfaceFinish(book.coverFinish)
  // Only the validated choice is saved; null explicitly removes the relief.
  if ('coverRelief' in (book || {})) result.coverRelief = normalizeCoverRelief(book.coverRelief)
  if ('pageEdgeFinish' in (book || {})) result.pageEdgeFinish = surfaceFinish(book.pageEdgeFinish)
  if ('spineSurfaceFinish' in (book || {})) result.spineSurfaceFinish = surfaceFinish(book.spineSurfaceFinish, 'matte')
  if (typeof book?.spineEngraved === 'boolean') result.spineEngraved = book.spineEngraved
  if (typeof book?.spineTitleOverride === 'string') result.spineTitleOverride = book.spineTitleOverride.slice(0,120)
  if ('author' in (book || {})) result.author = normalizeBookAuthor(book.author)
  if (['Playfair Display','Lora','Cormorant Garamond','DM Sans','Montserrat','Oswald'].includes(book?.spineFontFamily)) result.spineFontFamily = book.spineFontFamily
  if (Number.isFinite(book?.spineFontSize)) result.spineFontSize = clamp(book.spineFontSize,8,48)
  if (Number.isFinite(book?.spineAuthorFontSize)) result.spineAuthorFontSize = clamp(book.spineAuthorFontSize,6,36)
  return result
}
