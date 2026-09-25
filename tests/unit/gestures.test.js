import { describe, it, expect } from 'vitest'
import { classifyTapZone, classifySwipe, ZONE } from '../../src/js/gestures.js'

describe('classifyTapZone', () => {
  it('clasifica el 28% izquierdo como PREV', () => {
    expect(classifyTapZone(10, 400)).toBe(ZONE.PREV)
    expect(classifyTapZone(111, 400)).toBe(ZONE.PREV)
  })

  it('clasifica el 28% derecho como NEXT', () => {
    expect(classifyTapZone(390, 400)).toBe(ZONE.NEXT)
    expect(classifyTapZone(289, 400)).toBe(ZONE.NEXT)
  })

  it('clasifica el centro como CENTER', () => {
    expect(classifyTapZone(200, 400)).toBe(ZONE.CENTER)
  })

  it('con ancho 0 no revienta y devuelve CENTER', () => {
    expect(classifyTapZone(50, 0)).toBe(ZONE.CENTER)
  })
})

describe('classifySwipe', () => {
  it('un arrastre rápido hacia la izquierda es NEXT', () => {
    expect(classifySwipe({ dx: -80, dy: 2, durationMs: 150 })).toBe(ZONE.NEXT)
  })

  it('un arrastre rápido hacia la derecha es PREV', () => {
    expect(classifySwipe({ dx: 80, dy: -2, durationMs: 150 })).toBe(ZONE.PREV)
  })

  it('un arrastre demasiado corto no cuenta como swipe', () => {
    expect(classifySwipe({ dx: 10, dy: 0, durationMs: 100 })).toBeNull()
  })

  it('un arrastre demasiado lento no cuenta como swipe', () => {
    expect(classifySwipe({ dx: 100, dy: 0, durationMs: 900 })).toBeNull()
  })

  it('un arrastre más vertical que horizontal (scroll) no cuenta como swipe', () => {
    expect(classifySwipe({ dx: 50, dy: 120, durationMs: 150 })).toBeNull()
  })
})
