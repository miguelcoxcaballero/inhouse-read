import { describe, expect, it } from 'vitest'
import { coverColorFromPixels, withCoverAppearance } from '../../src/js/cover-appearance.js'

function splitCover(width, height, first, second, firstRatio = 0.8) {
  const data = new Uint8ClampedArray(width * height * 4)
  const splitAt = Math.round(width * firstRatio)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const color = x < splitAt ? first : second
      const at = (y * width + x) * 4
      data[at] = color[0]; data[at + 1] = color[1]; data[at + 2] = color[2]; data[at + 3] = 255
    }
  }
  return data
}

describe('cover appearance', () => {
  it('uses the largest colour area as the binding colour', () => {
    const appearance = coverColorFromPixels(
      splitCover(40, 48, [47, 107, 79], [238, 228, 211]), 40, 48
    )
    expect(appearance.color).toBe('#2f6b4f')
    expect(appearance.shade).not.toBe(appearance.color)
    expect(appearance.ink).toBe('#fffaf0')
  })

  it('chooses dark lettering on a pale cover and light lettering on a dark one', () => {
    const light = coverColorFromPixels(splitCover(12, 12, [245, 237, 220], [10, 10, 10]), 12, 12)
    const dark = coverColorFromPixels(splitCover(12, 12, [24, 40, 58], [240, 240, 240]), 12, 12)
    expect(light.ink).toBe('#171512')
    expect(dark.ink).toBe('#fffaf0')
  })

  it('adds cover styling without changing the deterministic book geometry', () => {
    const fallback = { color: '#7a2e38', shade: '#5b1f28', ink: '#f2e6d8', width: 42, texture: 'ribbed' }
    const matched = withCoverAppearance(fallback, {
      color: '#2f6b4f', shade: '#244f3c', ink: '#fffaf0', fontFamily: 'Lora', fontWeight: 700
    })
    expect(matched).toMatchObject({ color: '#2f6b4f', fontFamily: 'Lora', fontWeight: 700, width: 42, texture: 'ribbed' })
    expect(fallback.color).toBe('#7a2e38')
  })

  it('keeps the original style when the cover could not be analyzed', () => {
    const fallback = { color: '#2b3f63', width: 38 }
    expect(withCoverAppearance(fallback, null)).toBe(fallback)
    expect(coverColorFromPixels(null, 0, 0)).toBeNull()
  })
})
