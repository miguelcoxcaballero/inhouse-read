import { bookDataModule } from './book-data-native.js'
import { normalizeCoverRelief } from './cover-relief.js'
import { core, tables, inArena, f64View, writeUnits } from './catalogue-core.js'

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
export const spineFinish = value => bookDataModule().book_spine_finish(value)

export const SURFACE_FINISHES = Object.freeze(Object.fromEntries(Object.entries(tables.surfaceFinishes)
  .map(([name, finish]) => [name, Object.freeze(finish)])))
export const surfaceFinish = (value, fallback = 'satin') => bookDataModule().book_surface_finish(value, fallback, SURFACE_FINISHES)

/** Derive spine shading and legible title ink for any user-selected color. */
export function spineColorStyle(color) {
  const [colour, shade, ink] = hexes(core.spine_color_style, color, 3)
  return { color: colour, shade, ink }
}

/** Portable shelf coordinates: shelf index and horizontal fraction of a row. */
export const normalizeShelfPosition = value => bookDataModule().book_shelf_position(value)

const appearanceHost = { normalizedHex, normalizeCoverRelief, finishes:SURFACE_FINISHES }
/** Native decisions; the host only adapts existing Core numerical kernels. */
export const spineCustomization = book => bookDataModule().book_spine_customization(book, appearanceHost)
