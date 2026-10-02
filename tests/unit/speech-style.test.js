import { describe, it, expect } from 'vitest'
import { SPEECH_COLORS, speechCSS, speechOverlayColor } from '../../src/js/readers/speech-highlight.js'
import { READING_THEMES } from '../../src/js/readers/reading-preferences.js'

describe('sentence highlight style', () => {
  it('has its own colour for every reading theme, so a new theme cannot fall back by accident', () => {
    expect(Object.keys(SPEECH_COLORS).sort()).toEqual(Object.keys(READING_THEMES).sort())
    for (const theme of Object.keys(READING_THEMES)) {
      expect(speechCSS(theme)).toContain(SPEECH_COLORS[theme].tint)
      expect(speechOverlayColor(theme)).toMatch(/^#[0-9a-f]{6}$/i)
    }
  })
  it('is a plain wash: no underline that would double up on links, and the ink colour is never changed', () => {
    const css = speechCSS('paper')
    expect(css).not.toMatch(/underline|text-decoration|box-shadow/)
    expect(css).toContain('color:inherit')
    expect(speechCSS('no-such-theme')).toBe(css)
  })
  it('keeps the wash translucent so the text stays readable on every theme', () => {
    for (const { tint } of Object.values(SPEECH_COLORS)) {
      const alpha = Number(/,\s*([.\d]+)\)$/.exec(tint)[1])
      expect(alpha).toBeGreaterThanOrEqual(.3)
      expect(alpha).toBeLessThanOrEqual(.5)
    }
  })
})
