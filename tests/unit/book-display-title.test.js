import { describe, expect, it } from 'vitest'
import { displayBookTitle } from '../../src/js/book-title.js'

describe('displayBookTitle', () => {
  it('shows the title written on the spine everywhere, or the book\'s own', () => {
    expect(displayBookTitle({ title:'Tiny', spineTitleOverride:'  Claros   del bosque ' })).toBe('Claros del bosque')
    expect(displayBookTitle({ title:'Tiny', spineTitleOverride:'   ' })).toBe('Tiny')
    expect(displayBookTitle({ title:'Tiny' })).toBe('Tiny')
    expect(displayBookTitle(null)).toBe('')
  })
})
