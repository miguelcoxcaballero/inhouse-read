import { describe, expect, it } from 'vitest'
import { bookColorOptions, spineColorStyle } from '../../src/js/book-colors.js'

describe('book spine colors', () => {
  it('derives three distinct choices from the cover color', () => {
    const options = bookColorOptions('#a64235')
    expect(options).toHaveLength(3)
    expect(options[0]).toBe('#a64235')
    expect(new Set(options).size).toBe(3)
  })

  it('offers useful tones for grayscale covers too', () => {
    for (const cover of ['#808080', '#000000', '#ffffff']) {
      const options = bookColorOptions(cover)
      expect(options[0]).toBe(cover)
      expect(new Set(options).size).toBe(3)
    }
  })

  it('normalizes custom colors and chooses readable ink', () => {
    expect(spineColorStyle('#abc')).toEqual({ color: '#aabbcc', shade: '#818e9b', ink: '#171512' })
    expect(spineColorStyle('#102030').ink).toBe('#fffaf0')
  })
})
