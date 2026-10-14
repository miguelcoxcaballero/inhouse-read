import './helpers/rust-ui-ready.js'
import { expect, it } from 'vitest'
import { hasUntrackedPDFImages, paintPDFTheme } from '../../src/js/readers/pdf-page-theme.js'
import { hasUntrackedPDFImages as originalUntracked, paintPDFTheme as originalPaint } from './helpers/reference-pdf-page-theme.js'

// The compiled painter is compared with the frozen original on a large pseudo-random corpus: every
// canvas call and every property it sets, in order, for tiny and huge pictures alike.
function recorder(width, height) {
  const calls = []
  const ctx = new Proxy({}, {
    get: (target, key) => key in target ? target[key] : (...args) => { calls.push([String(key), ...args.map(value => typeof value === 'object' ? 'canvas' : value)]) },
    set: (target, key, value) => { target[key] = value; calls.push(['=' + String(key), value]); return true }
  })
  return { calls, source:{ width, height }, target:{ width, height, getContext:kind => { calls.push(['getContext', kind]); return ctx } } }
}
const FILTERS = ['none', 'sepia(.5) brightness(.94)', 'invert(.89) hue-rotate(180deg)', 'grayscale(1) invert(1) brightness(.77647)']

it('paints exactly like the original on a pseudo-random corpus of pages and footprints', () => {
  let state = 4242
  const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296 }
  const seen = { clipped:0, plain:0, many:0 }
  for (let round = 0; round < 600; round++) {
    const size = [[400, 600], [1, 1], [1170, 1560], [0, 0], [333.5, 777.25]][Math.floor(random() * 5)]
    const count = [0, 1, 2, 7, 40, 300][Math.floor(random() * 6)]
    const raw = Array.from({ length:count * 6 }, () => random() * 1.4 - .2)
    if (round % 11 === 0 && raw.length) raw[Math.floor(random() * raw.length)] = NaN
    const coordinates = [raw, Float32Array.from(raw), undefined][Math.floor(random() * 3)]
    const filter = FILTERS[Math.floor(random() * FILTERS.length)]
    const a = recorder(...size), b = recorder(...size)
    let first, second
    try { originalPaint(a.source, a.target, filter, coordinates) } catch (error) { first = error.message }
    try { paintPDFTheme(b.source, b.target, filter, coordinates) } catch (error) { second = error.message }
    expect(second, `round ${round}`).toBe(first)
    expect(b.calls, `round ${round}`).toEqual(a.calls)
    if (a.calls.some(call => call[0] === 'clip')) seen.clipped++; else seen.plain++
    if (a.calls.filter(call => call[0] === 'moveTo').length > 30) seen.many++
  }
  expect(seen.clipped).toBeGreaterThan(100)
  expect(seen.plain).toBeGreaterThan(100)
  expect(seen.many).toBeGreaterThan(20)
})

it('tells untracked stencil masks from tracked pictures like the original', () => {
  const ops = { paintImageMaskXObject:83, paintImageMaskXObjectGroup:84, paintImageMaskXObjectRepeat:85, paintSolidColorImageMask:86, paintImageXObject:90 }
  const lists = [undefined, null, {}, { fnArray:[] }, { fnArray:[1, 2, 83] }, { fnArray:[86] }, { fnArray:[90, 91] }, { fnArray:Int32Array.of(84) }, { fnArray:[NaN] }]
  for (const list of lists) for (const table of [ops, {}, undefined, { paintImageMaskXObject:'83' }]) {
    expect(hasUntrackedPDFImages(list, table)).toBe(originalUntracked(list, table))
  }
})
