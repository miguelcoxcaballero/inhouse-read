import './helpers/rust-ui-ready.js'
import { describe, expect, it } from 'vitest'
import { getRustCore } from '../../src/js/rust-core.js'
import { extractPDFText } from '../../src/js/readers/pdf-text.js'
import { extractPDFText as staged } from './helpers/reference-pdf-text-geometry.js'
import { extractPDFText as original } from './helpers/reference-pdf-text.js'

// extractPDFText used to cross into the core four times a page (geometry, rows, order, stream),
// rebuilding the line objects between the stages. It is now one pass (rust-core pdf_page_text.rs).
// `staged` is the frozen four-stage pipeline over the per-stage kernels (helpers/live-pdf-*.js);
// `original` is the complete JavaScript original. Against the pipeline a result must be the same
// value in every number (sign of zero included), every string and the order of every object's keys;
// the original put a line's softHyphen key earlier, so against it the values are compared.
function random(seed) {
  let state = seed >>> 0
  return () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 2 ** 32 }
}
const prose = ['Hola', 'mundo.', '  ', ' espacio ', 'café', '😀 emoji', 'يمين', 'שלום', '日本語。', '漢字', 'x', 'Capítulo 3', '—dijo—', ' nbsp ', '﻿bom',
  'con-', 'ti­', 'nuación', '­', 'palabra­', 'guion‐', 'ábaco', 'Ñandú', '\ud83d', '\ude00x', 'fin. ', '　ancho']
const counters = ['12', ' 7 ', '00012', '123456', 'iv', 'XIV', ' mcmxcix ', 'ivxlcdmi', 'İV', 'ıv', 'x ', ' 3﻿', '3a', '', '٣', 'v\n', '１２']
const lists = ['• ', '•x', '● uno', '▪ dos', '‣\ttres', '⁃ cuatro', '1. ', '12) b', '123. c', '1234. d', 'a) e', 'b. f', 'A) g', '1.x', '  a) h', 'a)', '1', '- i', 'é) j']
function page(seed) {
  const next = random(seed), pick = values => values[Math.floor(next() * values.length)]
  const columns = pick([1, 1, 2, 2, 3]), rows = 1 + Math.floor(next() * pick([4, 12, 40])), size = pick([12, 10, 9.5, 14])
  const width = 520 / columns, items = [], leading = size * pick([1.2, 1.5, 2.2])
  const tilt = next() < 0.06 ? pick([0.1, 0.3, Math.PI / 2]) : 0
  for (let column = 0; column < columns; column++) for (let row = 0; row < rows; row++) {
    if (next() < 0.08) continue
    const pieces = 1 + Math.floor(next() * 4)
    let x = 40 + column * (width + pick([0, 18, 30])) + (next() < 0.1 ? 14 : 0)
    const y = 60 + row * leading + (next() < 0.07 ? leading * 1.4 : 0) + (next() < 0.2 ? next() * 2 - 1 : 0)
    for (let piece = 0; piece < pieces; piece++) {
      const kind = next(), str = piece === 0 && kind < 0.12 ? pick(lists) : kind < 0.2 && pieces === 1 ? pick(counters) : pick(prose)
      const height = next() < 0.9 ? size : next() < 0.01 ? 0 : pick([size * 1.8, size * 0.6])
      const c = Math.cos(tilt) * height, s = Math.sin(tilt) * height
      const advance = str.length * height * pick([0.45, 0.5, 0.6])
      items.push({ str, dir:pick(['ltr', 'ltr', 'ltr', 'rtl', undefined]), width:pick([advance, advance, advance, undefined, 0, '20']),
        height:pick([height, height, undefined, 0]), transform:next() < 0.9995 ? [c, s, -s, c, x, 800 - y] : pick([undefined, [c, s, -s, c, x]]),
        hasEOL:next() < 0.3, fontName:pick(['f1', 'f2']) })
      x += advance + pick([0, 0, 1, 3, height * 0.5, height * 3])
    }
  }
  if (next() < 0.3) items.push({ str:pick(counters) || '9', dir:'ltr', width:12, height:size, transform:[size, 0, 0, size, 300, pick([20, 780])], hasEOL:true })
  if (next() < 0.1) items.push({ str:'' }, { str:5 })
  // The painted order need not be the reading order.
  if (next() < 0.5) for (let i = items.length - 1; i > 0; i--) { const j = Math.floor(next() * (i + 1)); [items[i], items[j]] = [items[j], items[i]] }
  return { content:{ items }, viewport:{ transform:pick([[1, 0, 0, -1, 0, 800], [1, 0, 0, -1, 0, 800], [1.5, 0, 0, -1.5, 0, 1200], undefined]) } }
}
// Same value, same key order, same sign of zero; the item objects are the page's own.
function identical(actual, expected, path = 'result') {
  if (typeof expected === 'number' || expected === null || typeof expected !== 'object') {
    if (!Object.is(actual, expected)) throw new Error(`${path}: ${String(actual)} is not ${String(expected)}`)
    return
  }
  if (Array.isArray(expected) !== Array.isArray(actual)) throw new Error(`${path}: array against object`)
  const keys = Object.keys(expected)
  if (Object.keys(actual).join('\n') !== keys.join('\n')) throw new Error(`${path}: keys ${Object.keys(actual)} are not ${keys}`)
  if (Array.isArray(expected) && actual.length !== expected.length) throw new Error(`${path}: length`)
  for (const key of keys) identical(actual[key], expected[key], `${path}.${key}`)
}
function compare(reference, content, viewport, check = identical) {
  const before = structuredClone(content)
  let expected, expectedError, actual, actualError
  try { expected = reference(content, viewport) } catch (error) { expectedError = error }
  try { actual = extractPDFText(content, viewport) } catch (error) { actualError = error }
  expect(actualError?.message).toBe(expectedError?.message)
  if (expectedError) return undefined
  check(actual, expected)
  expect(content).toEqual(before)
  if (actual.geometric) {
    const entries = new Set()
    for (const line of actual.lines) for (const entry of line.entries) { expect(entry.item).toBe(content.items[entry.rawIndex]); entries.add(entry) }
    expect(entries.size).toBe(content.items.filter(item => typeof item.str === 'string' && item.str).length)
    actual.spans.forEach(span => expect(actual.items[span.itemIndex].str).toBe(content.items[span.rawIndex].str))
  }
  return actual
}

describe('a PDF page of text in one pass through the core', () => {
  it('exports the pass', () => expect(getRustCore().pdf_page_text).toBeTypeOf('function'))
  it('is the frozen four-stage pipeline on 1500 generated pages, key for key and bit for bit', () => {
    const seen = { geometric:0, stream:0, soft:0, columns:0, paragraphs:0, rtl:0 }
    for (let seed = 1; seed <= 1500; seed++) {
      const { content, viewport } = page(seed), result = compare(staged, content, viewport)
      seen[result.geometric ? 'geometric' : 'stream']++
      if (!result.geometric) continue
      if (result.lines.some(line => line.softHyphen)) seen.soft++
      if (new Set(result.lines.map(line => line.column)).size > 1) seen.columns++
      if (result.paragraphs.length > 1) seen.paragraphs++
      if (result.lines.some(line => line.rtl)) seen.rtl++
    }
    expect(seen.geometric).toBeGreaterThan(900)
    expect(seen.stream).toBeGreaterThan(50)
    for (const key of ['soft', 'columns', 'paragraphs', 'rtl']) expect(seen[key], key).toBeGreaterThan(20)
  }, 60000)
  it('is the complete JavaScript original on 1000 generated pages', () => {
    let geometric = 0
    for (let seed = 5001; seed <= 6000; seed++) {
      const { content, viewport } = page(seed), result = compare(original, content, viewport, (actual, expected) => expect(actual).toEqual(expected))
      if (result?.geometric) geometric++
    }
    expect(geometric).toBeGreaterThan(600)
  }, 60000)
  it('answers the page-number and list questions like the regular expressions it replaced', () => {
    // One item per line, far apart: the order kernel sees each counter, the stream each list start.
    const view = { transform:[1, 0, 0, -1, 0, 800] }
    for (const texts of [counters.filter(Boolean), lists, [...counters.filter(Boolean), ...lists].reverse()]) {
      const items = texts.flatMap((str, index) => [
        { str:'Texto del cuerpo', dir:'ltr', width:90, height:12, transform:[12, 0, 0, 12, 40, 700 - index * 30], hasEOL:true },
        { str, dir:'ltr', width:str.length * 6, height:12, transform:[12, 0, 0, 12, 40, 686 - index * 30], hasEOL:true }])
      compare(staged, { items }, view)
      compare(staged, { items:items.filter((_, index) => index % 2) }, view)
    }
  })
  it('keeps pages beyond one retained arena and pages after them identical', () => {
    const big = { items:Array.from({ length:2600 }, (_, index) => ({ str:`w${index} `, dir:'ltr', width:20, height:8,
      transform:[8, 0, 0, 8, 30 + (index % 20) * 27, 790 - Math.floor(index / 20) * 5.8], hasEOL:false })) }
    const view = { transform:[1, 0, 0, -1, 0, 800] }
    for (let turn = 0; turn < 3; turn++) {
      expect(compare(staged, big, view).geometric).toBe(true)
      const { content, viewport } = page(77 + turn)
      compare(staged, content, viewport)
    }
  })
  it('skips holes in the item list like the original', () => {
    const items = [{ str:'a', dir:'ltr', width:6, height:12, transform:[12, 0, 0, 12, 40, 700] }, , { str:'b', dir:'ltr', width:6, height:12, transform:[12, 0, 0, 12, 60, 700] }]
    let expectedError, actualError, expected, actual
    try { expected = staged({ items }, undefined) } catch (error) { expectedError = error }
    try { actual = extractPDFText({ items }, undefined) } catch (error) { actualError = error }
    expect(actualError?.constructor).toBe(expectedError?.constructor)
    if (!expectedError) identical(actual, expected)
  })
})
