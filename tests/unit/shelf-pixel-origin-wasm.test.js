import { describe, expect, it } from 'vitest'
import { shelfPixelOffset } from '../../src/js/shelf-pixel-origin.js'
import { shelfPixelOffset as original } from './helpers/reference-shelf-pixel-origin.js'
import { prng } from './helpers/pointer-harness.js'

describe('compiled shelf pixel origin against the frozen JavaScript search', () => {
  it('returns the same offset, signed zeros included, for a large corpus of layouts', () => {
    const random = prng(11)
    const ratios = [1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 2.625, 2.75, 3, 3.5, 4, 0.5, 0.75, 1 / 3, 2.6666666666666665, 0, -1, NaN, Infinity]
    const sizes = [390, 391, 360.5, 412, 844, 843.5, 800, 1024, 333.3333, 0.25, 7]
    let nonzero = 0
    for (let index = 0; index < 300000; index++) {
      const top = random.chance(.3) ? random.pick([0, -0, 1, -1, 12.5, 100.25, 1e6 + .125, -3.75, 4503599627370496, 1e17, NaN, Infinity, -Infinity, Number.MIN_VALUE])
        : (random() - .3) * random.pick([10, 100, 1000, 20000]) + (random.chance(.5) ? random.pick([.125, .0625, .3333333333333333, .6]) : 0)
      const width = random.pick(sizes), height = random.pick(sizes), ratio = random.pick(ratios)
      // The original loops forever on tops beyond 2^53, where candidate - 1 === candidate.
      if (Math.abs(top) > 2 ** 52 && Number.isFinite(top) && Number.isInteger(width * ratio) && Number.isInteger(height * ratio) && ratio > 0) continue
      const want = original(top, width, height, ratio), got = shelfPixelOffset(top, width, height, ratio)
      if (!Object.is(want, got)) throw new Error(`shelfPixelOffset(${top}, ${width}, ${height}, ${ratio}) = ${got}, expected ${want}`)
      if (want !== 0) nonzero++
    }
    expect(nonzero).toBeGreaterThan(5000)
  })

  it('keeps the type check of the original for non-number arguments', () => {
    expect(shelfPixelOffset('12.5', 390, 844, 2)).toBe(original('12.5', 390, 844, 2))
    expect(shelfPixelOffset(12.5, null, 844, 2)).toBe(original(12.5, null, 844, 2))
    expect(shelfPixelOffset(undefined, 390, 844, 2)).toBe(0)
  })
})
