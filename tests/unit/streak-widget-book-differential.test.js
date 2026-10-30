import { afterEach, describe, expect, it } from 'vitest'
import * as ours from '../../src/js/streak-widget-book.js'
import * as frozen from './helpers/reference-streak-widget-book.js'

// rust-ui/src/reading_streak.rs (the widget's book) against the frozen original: the minutes on odd
// records and the whole cover recipe, recorded call by call on a canvas that answers like a browser's.

function random(seed) {
  let state = seed >>> 0
  return () => { state = (state + 0x6D2B79F5) >>> 0; let t = state; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296 }
}
const pick = (rng, list) => list[Math.floor(rng() * list.length)]

describe('widget book minutes', () => {
  it('minutes left and their rounding match on odd records', () => {
    const rng = random(5)
    const odd = [undefined, null, 0, -0, -1, 1, 0.5, 229, 230, 231, 345, 46000, 1e9, NaN, Infinity, -Infinity, '1000', ' 12 ', '', '0x40', true, false, [], [7], {}]
    for (const record of [null, undefined, {}, { wordCount: 0 }, 5, 'text', { wordCount: 1000 }])
      expect(Object.is(ours.minutesLeft(record), frozen.minutesLeft(record))).toBe(true)
    for (let i = 0; i < 3000; i++) {
      const record = { wordCount: rng() < 0.4 ? pick(rng, odd) : Math.floor(rng() * 200000), progressFraction: rng() < 0.4 ? pick(rng, odd) : rng() * 1.4 - 0.2 }
      const a = ours.minutesLeft(record), b = frozen.minutesLeft(record)
      expect(Object.is(a, b), JSON.stringify(record)).toBe(true)
    }
    for (const value of [-1, -0, 0, 0.1, 1, 4.99, 5, 5.01, 41, 59, 59.5, 59.9999, 60, 64, 65, 203, 205, 1234.5, 1e12, NaN, Infinity, -Infinity, -0.0001, '30', null])
      expect(Object.is(ours.roundedMinutes(value), frozen.roundedMinutes(value)), String(value)).toBe(true)
  })
})

// ---------------------------------------------------------------- the cover
/** A 2D canvas that logs every call and property write, measuring text by its code units. */
function recordingCanvas(log, { brokenContext = false } = {}) {
  const gradient = id => ({ addColorStop: (...args) => log.push(['gradient', id, ...args]) })
  let gradients = 0
  const values = {}
  const context = new Proxy({}, {
    get(_, key) {
      if (key in values) return values[key]
      if (key === 'createLinearGradient') return (...args) => { log.push(['createLinearGradient', ...args]); return gradient(gradients++) }
      if (key === 'measureText') return text => { log.push(['measureText', text]); let width = 0; for (let i = 0; i < text.length; i++) width += 6 + text.charCodeAt(i) % 11; return { width } }
      return (...args) => { log.push([key, ...args.map(arg => arg?.bitmap ?? arg)]) }
    },
    set(_, key, value) { values[key] = value; log.push(['set', key, typeof value === 'object' ? 'gradient' : value]); return true }
  })
  return {
    set width(value) { log.push(['canvas width', value]) },
    set height(value) { log.push(['canvas height', value]) },
    getContext: type => { log.push(['getContext', type]); return brokenContext ? null : context },
    toDataURL: type => { log.push(['toDataURL', type]); return pick(random(log.length), ['data:image/png;base64,QUJD', 'data:,', 'data:image/png;base64,QQ,extra', 'nothing']) }
  }
}

async function draw(cover, record, title, setup) {
  const log = []
  const create = document.createElement
  document.createElement = tag => { log.push(['createElement', tag]); return recordingCanvas(log, setup) }
  const bitmap = globalThis.createImageBitmap
  if (setup.bitmap === 'missing') delete globalThis.createImageBitmap
  else globalThis.createImageBitmap = async blob => {
    log.push(['createImageBitmap', blob.size])
    if (setup.bitmap === 'fails') throw new Error('decode')
    return { bitmap: `bitmap ${blob.size}`, width: setup.width, height: setup.height, ...(setup.close ? { close: () => log.push(['close']) } : {}), ...(setup.closeThrows ? { close: () => { throw new Error('closed') } } : {}) }
  }
  try {
    const result = await cover(record, title).then(value => ['ok', value], error => ['error', error?.constructor?.name])
    log.push(result)
  } finally {
    document.createElement = create
    if (bitmap) globalThis.createImageBitmap = bitmap; else delete globalThis.createImageBitmap
  }
  return log
}

const TITLES = ['', ' ', 'Libro', 'Un libro', '  Dos   espacios  ', 'Cien años de soledad y otras historias muy largas que no caben en cuatro líneas de portada nunca',
  'Tab\tand\nnew line', 'No break em　ideographic﻿bom\u0085nel', '😀 emoji 👍🏽 family 👨‍👩‍👧', 'lone \ud800 high', 'lone \udc00 low', 'Ñandú', 'Supercalifragilisticoespialidoso-extraordinariamente-largo palabra',
  'a b c d e f g h i j k l m n o p q r s t u v w x y z', 'Ⅻ ⅻ', '  ']

describe('widget book cover', () => {
  afterEach(() => { delete globalThis.__coverSetup })
  it('draws the same thumbnail, call by call, on every path', async () => {
    const rng = random(17)
    const setups = [{ bitmap: 'ok', width: 300, height: 450, close: true }, { bitmap: 'ok', width: 100, height: 400 }, { bitmap: 'ok', width: 0, height: 0, close: true },
      { bitmap: 'fails' }, { bitmap: 'missing' }, { bitmap: 'ok', width: 640, height: 200, closeThrows: true }, { brokenContext: true, bitmap: 'ok', width: 1, height: 1 }]
    let compared = 0
    for (const title of TITLES) for (const setup of setups) for (const cover of [new Blob(['x'.repeat(12)]), null, { size: 3 }, 'blob']) {
      const record = rng() < 0.1 ? null : { id: 'b', cover }
      const a = await draw(ours.coverPng, record, title, setup)
      const b = await draw(frozen.coverPng, record, title, setup)
      expect(a, `${JSON.stringify(title)} ${JSON.stringify(setup)}`).toEqual(b)
      compared++
    }
    expect(compared).toBe(TITLES.length * 7 * 4)
  })
})
