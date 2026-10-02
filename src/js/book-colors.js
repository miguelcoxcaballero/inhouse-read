import { normalizeBookAuthor } from './book-title.js'
import { normalizeCoverRelief } from './cover-relief.js'
const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

function parseHex(value) {
  const match = /^#?([\da-f]{3}|[\da-f]{6})$/i.exec(String(value ?? '').trim())
  if (!match) return null
  const hex = match[1].length === 3 ? [...match[1]].map(char => char + char).join('') : match[1]
  return [0, 2, 4].map(index => Number.parseInt(hex.slice(index, index + 2), 16))
}

function toHex(values) {
  return `#${values.map(value => Math.round(clamp(value, 0, 255)).toString(16).padStart(2, '0')).join('')}`
}

function toHsl([r8, g8, b8]) {
  const [r, g, b] = [r8, g8, b8].map(value => value / 255)
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const lightness = (max + min) / 2
  const delta = max - min
  let hue = 0, saturation = 0
  if (delta) {
    saturation = delta / (1 - Math.abs(2 * lightness - 1))
    if (max === r) hue = 60 * (((g - b) / delta) % 6)
    else if (max === g) hue = 60 * ((b - r) / delta + 2)
    else hue = 60 * ((r - g) / delta + 4)
  }
  return { hue: (hue + 360) % 360, saturation, lightness }
}

// Book cloth, not a UI palette: deep, dyed tones a binder would stock.
const BOOKCLOTH = [
  '#6e2a2a', '#9a4a2c', '#9a7432', '#5e6130', '#4f6a2e', '#245439', // oxblood, rust, ochre, olive, moss, bottle green
  '#1f5359', '#3a5470', '#1f2f52', '#3b3368', '#5a2a50', '#7a2e3e' // peacock, slate, navy, indigo, aubergine, claret
].map(hex => ({ hex, rgb:parseHex(hex), hue:toHsl(parseHex(hex)).hue }))
const hueDistance = (a, b) => { const d = Math.abs(((a - b) % 360 + 360) % 360); return Math.min(d, 360 - d) }

/** Cloth nearest a target hue that stays clearly apart from the colours already offered. */
function clothNear(hue, taken) {
  const ranked = [...BOOKCLOTH].sort((a, b) => hueDistance(a.hue, hue) - hueDistance(b.hue, hue))
  return (ranked.find(cloth => taken.every(rgb => Math.hypot(...cloth.rgb.map((v, i) => v - rgb[i])) > 80)) ?? ranked[0]).hex
}

/** The cover colour plus two split-complementary cloths; neutral covers get oxblood and navy. */
export function bookColorOptions(coverColor) {
  const rgb = parseHex(coverColor) ?? [139, 94, 60]
  const base = toHex(rgb)
  const { hue, saturation } = toHsl(rgb)
  if (saturation < .16) return [base, '#6e2a2a', '#1f2f52']
  const second = clothNear(hue + 135, [rgb])
  return [base, second, clothNear(hue + 245, [rgb, parseHex(second)])]
}

export const METAL_COLORS = { gold:'#d6ad55', silver:'#d5dce3' }
export function spineFinish(value) { return ['gold','silver'].includes(value) ? value : 'matte' }

export const SURFACE_FINISHES = Object.freeze({
  // Laminate thickness changes the specular lobe, never the printed colour.
  // A soft satin reflection must stay broader than a glossy jacket's bright
  // window or lamp reflection; matte stock has no smooth outer coating.
  glossy: Object.freeze({ roughness:.18, clearcoat:1, clearcoatRoughness:.065, envMapIntensity:1.35 }),
  satin: Object.freeze({ roughness:.48, clearcoat:.35, clearcoatRoughness:.28, envMapIntensity:1.1 }),
  matte: Object.freeze({ roughness:.94, clearcoat:0, clearcoatRoughness:.6, envMapIntensity:1 })
})
export function surfaceFinish(value, fallback = 'satin') {
  if (typeof value === 'string' && Object.hasOwn(SURFACE_FINISHES, value)) return value
  return typeof fallback === 'string' && Object.hasOwn(SURFACE_FINISHES, fallback) ? fallback : 'satin'
}

/** Derive spine shading and legible title ink for any user-selected color. */
export function spineColorStyle(color) {
  const rgb = parseHex(color) ?? [139, 94, 60]
  const channels = rgb.map(value => value / 255)
  const linear = channels.map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
  const luminance = 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]
  const whiteContrast = 1.05 / (luminance + 0.05)
  const darkContrast = (luminance + 0.05) / 0.057
  return {
    color: toHex(rgb),
    shade: toHex(rgb.map(value => value * 0.76)),
    ink: whiteContrast >= darkContrast ? '#fffaf0' : '#171512'
  }
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
    else if (parseHex(book?.[key])) result[key] = toHex(parseHex(book[key]))
  }
  for (const key of ['spineFinish','spineTextFinish']) if (key in (book || {})) result[key] = spineFinish(book[key])
  if ('coverFinish' in (book || {})) result.coverFinish = surfaceFinish(book.coverFinish)
  // Only the choice is saved ({ id, strength }); the maps are rebuilt from the cover. null removes it.
  if (book?.coverRelief === null) result.coverRelief = null
  else if (normalizeCoverRelief(book?.coverRelief)) result.coverRelief = normalizeCoverRelief(book.coverRelief)
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
