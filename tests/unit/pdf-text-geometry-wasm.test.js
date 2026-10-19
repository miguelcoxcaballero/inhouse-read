import './helpers/rust-ui-ready.js'
import { describe, expect, it, vi } from 'vitest'
import { getRustCore } from '../../src/js/rust-core.js'
import { extractPDFText } from '../../src/js/readers/pdf-text.js'
import { extractPDFText as frozen } from './helpers/reference-pdf-text-geometry.js'

// Item geometry moved from pdf-text.js to rust-core pdf_text_geometry.rs. The frozen copy keeps
// the JavaScript geometry over the same production row/order/stream kernels, so any difference
// in a result is the geometry's.
function random(seed) {
  let state = seed >>> 0
  return () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 2 ** 32 }
}
const words = ['Hola', 'mundo.', '  ', ' espacio ', 'café', '😀 emoji', 'يمين', 'שלום', '日本語。', 'x', 'Capítulo 3', '—dijo—', ' nbsp ', '﻿bom']
function page(seed) {
  const next = random(seed), pick = values => values[Math.floor(next() * values.length)]
  const angle = pick([0, 0, 0, Math.PI / 2, -Math.PI / 2, 0.15, 0.25, Math.PI, 0.3])
  const count = 1 + Math.floor(next() * 24), items = []
  for (let index = 0; index < count; index++) {
    const size = next() < 0.97 ? pick([12, 10, 14, 9.5, 24]) : pick([0, 1e-9, 1e200])
    const local = next() < 0.95 ? angle : angle + pick([0.05, 0.4, 1.2, -0.3])
    const c = Math.cos(local) * size, s = Math.sin(local) * size
    const row = Math.floor(index / 3), x = 40 + (index % 3) * 150 + next() * 4, y = 60 + row * pick([14, 18, 12.5])
    const transform = next() < 0.97 ? (next() < 0.9 ? [c, s, -s, c, x, 800 - y] : [size, 0, 0, size, x, 800 - y]) : pick([
      [c, s, -s, c, x, 800 - y].map(String), [c, s, -s, c, x], [c, s, -s, c, x, NaN],
      [0, 0, 0, size, x, 800 - y], [c, s, -s, c, 1e308, 1e308], [c, s, -s, c, x, Infinity], undefined])
    items.push({ str:pick(words), dir:next() < 0.02 ? 'ttb' : pick(['ltr', 'ltr', 'rtl', undefined, 'ltr']), transform,
      width:pick([undefined, null, '', '33', 48, 0, -5, NaN, Infinity, 120.5, 1e308]),
      height:pick([undefined, null, 12, '9', 0, NaN, -3]), hasEOL:next() < 0.5, fontName:'f' })
    if (next() < 0.05) items.push({ str:'', transform:[12, 0, 0, 12, 0, 0] })
    if (next() < 0.05) items.push({ str:7 })
  }
  const viewport = { transform:pick([[1, 0, 0, -1, 0, 800], [1, 0, 0, -1, 0, 800], [2, 0, 0, -2, 0, 1600], [0, 1, 1, 0, 0, 0],
    [1, 0, 0, -1, 0], [1, 0, 0, -1, 0, NaN], undefined, [0, 0, 0, 0, 0, 0], [1.5, 0, 0, -1.5, '0', '1200'].slice(0, 4).concat([0, 1200])]) }
  return { content:{ items }, viewport }
}
function same(content, viewport) {
  const original = structuredClone(content)
  let expected, expectedError, actual, actualError
  try { expected = frozen(content, viewport) } catch (error) { expectedError = error }
  try { actual = extractPDFText(content, viewport) } catch (error) { actualError = error }
  expect(actualError?.constructor).toBe(expectedError?.constructor)
  expect(actualError?.message).toBe(expectedError?.message)
  expect(actual).toEqual(expected)
  expect(content).toEqual(original)
  if (actual?.geometric) for (const line of actual.lines) for (const entry of line.entries) expect(entry.item).toBe(content.items[entry.rawIndex])
  return actual
}

describe('PDF item geometry in Rust', () => {
  it('matches the frozen JavaScript geometry on 4000 generated pages, including every stream fallback', () => {
    const outcomes = { geometric:0, stream:0 }
    for (let seed = 1; seed <= 4000; seed++) {
      const { content, viewport } = page(seed), result = same(content, viewport)
      outcomes[result.geometric ? 'geometric' : 'stream']++
    }
    // Both branches are exercised substantially.
    expect(outcomes.geometric).toBeGreaterThan(400)
    expect(outcomes.stream).toBeGreaterThan(400)
  })
  it('keeps the first longest trimmed item as the direction, rotated pages and right-to-left majorities', () => {
    const at = (str, angle, x, y, dir = 'ltr') => ({ str, dir, width:str.length * 6, height:12, hasEOL:true,
      transform:[12 * Math.cos(angle), 12 * Math.sin(angle), -12 * Math.sin(angle), 12 * Math.cos(angle), x, y] })
    for (const angle of [0, 0.1, 0.2, Math.PI / 2, Math.PI, -2.9, 0.19999]) {
      same({ items:[at('  same  ', angle, 10, 700), at('same', angle + 0.01, 90, 700), at('a', angle + 0.3, 10, 650)] }, { transform:[1, 0, 0, -1, 0, 800] })
      same({ items:[at('abc', angle, 10, 700, 'rtl'), at('abcd', angle, 90, 700), at('ab', angle, 10, 680, 'rtl')] }, { transform:[1, 0, 0, -1, 0, 800] })
      same({ items:[at('abc', angle, 10, 700, 'rtl'), at('abc', angle, 90, 700)] }, { transform:[1, 0, 0, -1, 0, 800] })
    }
  })
  it('still throws for a transform that claims six values but cannot be spread', () => {
    const content = { items:[{ str:'x', transform:{ length:6, 0:1, 1:0, 2:0, 3:1, 4:0, 5:0 } }] }
    expect(() => frozen(content, {})).toThrow(TypeError)
    expect(() => extractPDFText(content, {})).toThrow(TypeError)
  })
  it('asks the engine for its arctangents and releases every arena with its length', async () => {
    const real = getRustCore(), allocated = [], freed = []
    const core = { ...real, alloc_f64:length => { const pointer = real.alloc_f64(length); allocated.push([pointer, length]); return pointer },
      free_f64:(pointer, length) => { freed.push([pointer, length]); real.free_f64(pointer, length) } }
    vi.resetModules()
    vi.doMock('../../src/js/rust-core.js', () => ({ getRustCore:() => core }))
    const atan2 = vi.spyOn(Math, 'atan2')
    try {
      const { extractPDFText:isolated } = await import('../../src/js/readers/pdf-text.js')
      for (let seed = 1; seed <= 50; seed++) { const { content, viewport } = page(seed); expect(isolated(content, viewport)).toEqual(frozen(content, viewport)) }
      expect(atan2).toHaveBeenCalled()
      const order = (a, b) => a[0] - b[0] || a[1] - b[1]
      expect(allocated.length).toBeGreaterThan(50)
      // pdf-row-layout-wasm.js deliberately keeps one bounded arena for the next page.
      const open = allocated.filter(([pointer, length]) => !freed.some(entry => entry[0] === pointer && entry[1] === length))
      expect(open.length).toBeLessThanOrEqual(1)
      expect(freed.sort(order)).toEqual(allocated.filter(entry => !open.includes(entry)).sort(order))
    } finally { atan2.mockRestore(); vi.doUnmock('../../src/js/rust-core.js'); vi.resetModules() }
  })
  it('reports a missing numeric core instead of guessing an order', async () => {
    vi.resetModules()
    vi.doMock('../../src/js/rust-core.js', () => ({ getRustCore:() => null }))
    try {
      const { extractPDFText:isolated } = await import('../../src/js/readers/pdf-text.js')
      expect(() => isolated({ items:[{ str:'x', transform:[12, 0, 0, 12, 0, 0] }] }, {})).toThrow('El módulo numérico no se pudo cargar')
      expect(isolated({ items:[] }, {})).toMatchObject({ geometric:false, text:'' })
    } finally { vi.doUnmock('../../src/js/rust-core.js'); vi.resetModules() }
  })
})
