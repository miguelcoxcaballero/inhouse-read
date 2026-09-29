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

function fromHsl(hue, saturation, lightness) {
  const h = ((hue % 360) + 360) % 360
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation
  const x = chroma * (1 - Math.abs((h / 60) % 2 - 1))
  const m = lightness - chroma / 2
  const rgb = h < 60 ? [chroma, x, 0]
    : h < 120 ? [x, chroma, 0]
      : h < 180 ? [0, chroma, x]
        : h < 240 ? [0, x, chroma]
          : h < 300 ? [x, 0, chroma] : [chroma, 0, x]
  return toHex(rgb.map(value => (value + m) * 255))
}

/** Distinct cover-inspired choices; neutral covers get warm/cool accents. */
export function bookColorOptions(coverColor) {
  const rgb = parseHex(coverColor) ?? [139, 94, 60]
  const base = toHex(rgb)
  const { hue, saturation } = toHsl(rgb)
  if (saturation < .16) return [base, '#87613f', '#315e58']
  return [base, fromHsl(hue + 135, .42, .32), fromHsl(hue + 245, .48, .54)]
}

export const METAL_COLORS = { gold:'#d6ad55', silver:'#d5dce3' }
export function spineFinish(value) { return ['gold','silver'].includes(value) ? value : 'matte' }

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

/** Explicit allow-list for saved appearance, including resets to automatic. */
export function spineCustomization(book) {
  const result = {}
  for (const key of ['spineColorOverride','spineTextColor']) {
    if (book?.[key] === null) result[key] = null
    else if (parseHex(book?.[key])) result[key] = toHex(parseHex(book[key]))
  }
  for (const key of ['spineFinish','spineTextFinish']) if (key in (book || {})) result[key] = spineFinish(book[key])
  if (typeof book?.spineEngraved === 'boolean') result.spineEngraved = book.spineEngraved
  if (typeof book?.spineTitleOverride === 'string') result.spineTitleOverride = book.spineTitleOverride.slice(0,120)
  if (['Playfair Display','Lora','Cormorant Garamond','DM Sans','Montserrat','Oswald'].includes(book?.spineFontFamily)) result.spineFontFamily = book.spineFontFamily
  if (Number.isFinite(book?.spineFontSize)) result.spineFontSize = clamp(book.spineFontSize,8,18)
  return result
}
