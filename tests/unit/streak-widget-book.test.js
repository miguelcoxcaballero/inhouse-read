import { describe, expect, it } from 'vitest'
import { minutesLeft, roundedMinutes } from '../../src/js/streak-widget-book.js'

describe('tiempo que queda del libro para el widget', () => {
  it('usa las palabras que faltan a 230 palabras por minuto', () => {
    expect(minutesLeft({ wordCount: 46000, progressFraction: 0 })).toBe(200)
    expect(minutesLeft({ wordCount: 46000, progressFraction: 0.5 })).toBe(100)
    expect(minutesLeft({ wordCount: 46000, progressFraction: 1 })).toBe(0)
  })
  it('no inventa un tiempo si no se conoce la longitud', () => {
    expect(minutesLeft({ progressFraction: 0.2 })).toBe(-1)
    expect(minutesLeft({ wordCount: 0 })).toBe(-1)
    expect(minutesLeft(null)).toBe(-1)
  })
  it('acota el progreso y redondea para no reescribir el widget en cada página', () => {
    expect(minutesLeft({ wordCount: 2300, progressFraction: -3 })).toBe(10)
    expect(roundedMinutes(-1)).toBe(-1)
    expect(roundedMinutes(0)).toBe(0)
    expect(roundedMinutes(3)).toBe(5)
    expect(roundedMinutes(41)).toBe(45)
    expect(roundedMinutes(203)).toBe(200)
  })
})
