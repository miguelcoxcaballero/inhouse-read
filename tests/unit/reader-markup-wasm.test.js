import './helpers/rust-ui-ready.js'
import { expect, it } from 'vitest'
import { readerIcon, readerPanelMarkup } from '../../src/js/readers/reader-interface.js'
import { readerIcon as originalIcon, readerPanelMarkup as originalMarkup } from './helpers/reference-reader-interface.js'
import { RATE_STEPS, rateLabel } from '../../src/js/readers/reading-preferences.js'
import { rustUI } from './helpers/rust-ui-ready.js'

// The panel and its icons are produced by the compiled module; the frozen original template is the oracle.
it('produces the same panel markup, character for character', () => {
  expect(readerPanelMarkup()).toBe(originalMarkup)
  expect(readerPanelMarkup().length).toBeGreaterThan(10000)
})

it('draws every icon, and the play triangle for anything else, like the original', () => {
  for (const name of ['close', 'play', 'pause', 'stop', 'bookmark', 'minus', 'plus', 'search', 'quote', 'prev', 'next', 'missing', '', undefined, null, 7]) {
    expect(readerIcon(name), String(name)).toBe(originalIcon(name))
  }
})

it('lists one speed choice per step with the comma the labels use', () => {
  const rates = steps => steps.map(step => `<label class="reading-speed__step"><input type="radio" name="reading-rate" value="${step}" data-rate><span>${rateLabel(step)}</span></label>`).join('')
  for (const steps of [RATE_STEPS, [], [1], [0.5, 1.25, 3], [1e21, -0.75, 0.1 + 0.2]]) {
    expect(rustUI.reader_panel_markup(steps)).toBe(originalMarkup.replace(rates(RATE_STEPS), () => rates(steps)))
  }
})
