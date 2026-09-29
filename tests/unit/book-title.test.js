import { describe, expect, it } from 'vitest'
import { normalizeBookTitle } from '../../src/js/book-title.js'

describe('normalizeBookTitle', () => {
  it('turns filename underscores into readable title case and removes its extension', () => {
    expect(normalizeBookTitle('the_hobbit_and_the_lonely_mountain.epub'))
      .toBe('The Hobbit and the Lonely Mountain')
  })

  it('removes the incomplete tail of an already-truncated title', () => {
    expect(normalizeBookTitle('Immune_A_Journey_into_the_Mysterious_System_That_Ke...'))
      .toBe('Immune A Journey into the Mysterious System…')
  })

  it('keeps the main title when a long subtitle follows a colon', () => {
    expect(normalizeBookTitle('A Very Important Book: A Long Subtitle With Many Extra Words That Should Not Crowd the Shelf'))
      .toBe('A Very Important Book')
  })

  it('bounds long titles at a word boundary', () => {
    const title = normalizeBookTitle('one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty twentyone')
    expect(title.endsWith('…')).toBe(true)
    expect(title.length).toBeLessThanOrEqual(88)
    expect(title).not.toMatch(/\s…$/)
  })

  it('preserves punctuation, acronyms, and intentional internal capitals', () => {
    expect(normalizeBookTitle('NASA & iPhone: A SHORT Guide.pdf'))
      .toBe('NASA & iPhone: A Short Guide')
  })

  it('uses the fallback when metadata is blank', () => {
    expect(normalizeBookTitle('', 'my_book.cbz')).toBe('My Book')
  })
})
