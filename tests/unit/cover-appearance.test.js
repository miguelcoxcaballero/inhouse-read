import { afterEach, describe, expect, it, vi } from 'vitest'
import { analyzeCoverAppearance, coverAspectRatio, coverColorFromPixels, glyphMask, nearEdgeMap, runInSlices, scoreFontMask, withCoverAppearance } from '../../src/js/cover-appearance.js'

function splitCover(width, height, first, second, firstRatio = 0.8) {
  const data = new Uint8ClampedArray(width * height * 4)
  const splitAt = Math.round(width * firstRatio)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const color = x < splitAt ? first : second
      const at = (y * width + x) * 4
      data[at] = color[0]; data[at + 1] = color[1]; data[at + 2] = color[2]; data[at + 3] = 255
    }
  }
  return data
}

describe('cover appearance', () => {
  it('uses the decoded image proportions for the physical front cover', () => {
    expect(coverAspectRatio(900, 1200)).toBe(0.75)
    expect(coverAspectRatio(1600, 900)).toBeCloseTo(1600 / 900)
    expect(coverAspectRatio(9000, 900)).toBe(2.5)
    expect(coverAspectRatio(0, 900)).toBeNull()
    expect(withCoverAppearance({ coverRatio: 0.66 }, { aspectRatio: 0.82 }).coverRatio).toBe(0.82)
  })

  it('uses the largest colour area as the binding colour', () => {
    const appearance = coverColorFromPixels(
      splitCover(40, 48, [47, 107, 79], [238, 228, 211]), 40, 48
    )
    expect(appearance.color).toBe('#2f6b4f')
    expect(appearance.shade).not.toBe(appearance.color)
    expect(appearance.ink).toBe('#fffaf0')
  })

  it('chooses dark lettering on a pale cover and light lettering on a dark one', () => {
    const light = coverColorFromPixels(splitCover(12, 12, [245, 237, 220], [10, 10, 10]), 12, 12)
    const dark = coverColorFromPixels(splitCover(12, 12, [24, 40, 58], [240, 240, 240]), 12, 12)
    expect(light.ink).toBe('#171512')
    expect(dark.ink).toBe('#fffaf0')
  })

  it('matches cover styling and the front board to the analyzed image', () => {
    const fallback = { color: '#7a2e38', shade: '#5b1f28', ink: '#f2e6d8', width: 42, texture: 'ribbed' }
    const matched = withCoverAppearance(fallback, {
      color: '#2f6b4f', shade: '#244f3c', ink: '#fffaf0', fontFamily: 'Lora', fontWeight: 700,
      aspectRatio: 0.82
    })
    expect(matched).toMatchObject({ color: '#2f6b4f', fontFamily: 'Lora', fontWeight: 700, width: 42, texture: 'ribbed', coverRatio: 0.82 })
    expect(fallback.color).toBe('#7a2e38')
  })

  it('keeps the original style when the cover could not be analyzed', () => {
    const fallback = { color: '#2b3f63', width: 38 }
    expect(withCoverAppearance(fallback, null)).toBe(fallback)
    expect(coverColorFromPixels(null, 0, 0)).toBeNull()
  })
})

// The title-font matcher is time-sliced and expressed over flat arrays. The
// functions below are the ORIGINAL straight-line implementation, kept verbatim
// as the reference the sliced code must reproduce bit for bit (the scores pick
// the saved font of every book, so one different float could change lettering).
const clamp = (value, low, high) => Math.min(high, Math.max(low, value))
function referenceEdgeMap(gray, width, height) {
  const edges = new Float32Array(gray.length)
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const at = y * width + x
      edges[at] = Math.min(255, Math.abs(gray[at + 1] - gray[at - 1]) + Math.abs(gray[at + width] - gray[at - width]))
    }
  }
  return edges
}
function referenceMask(raw, maxWidth, rows) {
  let minX = maxWidth, minY = rows, maxX = -1, maxY = -1
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < maxWidth; x += 1) {
      if (raw[(y * maxWidth + x) * 4 + 3] < 100) continue
      minX = Math.min(minX, x); minY = Math.min(minY, y)
      maxX = Math.max(maxX, x); maxY = Math.max(maxY, y)
    }
  }
  if (maxX < minX || maxY < minY) return null
  const contentWidth = maxX - minX + 1, contentHeight = maxY - minY + 1
  const mask = new Uint8Array(contentWidth * contentHeight)
  for (let y = 0; y < contentHeight; y += 1) {
    for (let x = 0; x < contentWidth; x += 1) {
      const at = ((minY + y) * maxWidth + minX + x) * 4 + 3
      mask[y * contentWidth + x] = raw[at] >= 100 ? 1 : 0
    }
  }
  const perimeter = [], foreground = [], background = []
  for (let y = 1; y < contentHeight - 1; y += 1) {
    for (let x = 1; x < contentWidth - 1; x += 1) {
      const at = y * contentWidth + x
      if (mask[at]) foreground.push([x, y])
      else background.push([x, y])
      if (!mask[at]) continue
      if (!mask[at - 1] || !mask[at + 1] || !mask[at - contentWidth] || !mask[at + contentWidth]) perimeter.push([x, y])
    }
  }
  if (perimeter.length < 8) return null
  const sampleEvery = Math.max(1, Math.ceil(perimeter.length / 280))
  const samplePixels = (points, limit = 500) => {
    const every = Math.max(1, Math.ceil(points.length / limit))
    return points.filter((_, index) => index % every === 0)
  }
  return {
    width: contentWidth, height: contentHeight, mask,
    perimeter: perimeter.filter((_, index) => index % sampleEvery === 0),
    foreground: samplePixels(foreground), background: samplePixels(background)
  }
}
function referenceScore(gray, edges, width, height, workHeight, mask) {
  const scoreAt = (x, y) => {
    let total = 0
    for (const [mx, my] of mask.perimeter) {
      const at = (y + my) * width + x + mx
      total += Math.max(edges[at], edges[at - 1], edges[at + 1], edges[at - width], edges[at + width])
    }
    const meanAt = points => {
      if (!points.length) return 0
      let sum = 0
      for (const [mx, my] of points) sum += gray[(y + my) * width + x + mx]
      return sum / points.length
    }
    const textContrast = Math.abs(meanAt(mask.foreground) - meanAt(mask.background))
    return total / mask.perimeter.length + textContrast * .8
  }
  const shapeScoreAt = (x, y) => {
    let border = 0, borderCount = 0
    for (let offset = -2; offset < mask.width + 2; offset += 3) {
      for (const edgeY of [y - 2, y + mask.height + 1]) {
        if (edgeY < 0 || edgeY >= height) continue
        border += gray[edgeY * width + clamp(x + offset, 0, width - 1)]
        borderCount += 1
      }
    }
    for (let offset = -2; offset < mask.height + 2; offset += 3) {
      for (const edgeX of [x - 2, x + mask.width + 1]) {
        if (edgeX < 0 || edgeX >= width) continue
        border += gray[clamp(y + offset, 0, height - 1) * width + edgeX]
        borderCount += 1
      }
    }
    const background = border / Math.max(1, borderCount)
    const brightText = background < 128
    const threshold = brightText ? background + 46 : background - 46
    let intersection = 0, union = 0
    for (let my = 0; my < mask.height; my += 1) {
      for (let mx = 0; mx < mask.width; mx += 1) {
        const predicted = mask.mask[my * mask.width + mx] === 1
        const value = gray[(y + my) * width + x + mx]
        const observed = brightText ? value > threshold : value < threshold
        if (predicted && observed) intersection += 1
        if (predicted || observed) union += 1
      }
    }
    return union ? intersection / union : 0
  }
  let bestX = 1, bestY = 5, maskScore = 0
  for (let y = 5; y <= workHeight - mask.height - 2; y += 8) {
    for (let x = 1; x <= width - mask.width - 1; x += 8) {
      const score = scoreAt(x, y)
      if (score > maskScore) { maskScore = score; bestX = x; bestY = y }
    }
  }
  let matchedShapeScore = 0
  for (let y = Math.max(5, bestY - 8); y <= Math.min(workHeight - mask.height - 2, bestY + 8); y += 3) {
    for (let x = Math.max(1, bestX - 8); x <= Math.min(width - mask.width - 1, bestX + 8); x += 3) {
      const coarse = scoreAt(x, y)
      const shape = shapeScoreAt(x, y)
      const combined = shape * 400 + coarse * .12
      if (combined > matchedShapeScore) matchedShapeScore = combined
    }
  }
  return matchedShapeScore
}

function prng(seed) {
  let s = seed >>> 0
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296 }
}
// A synthetic cover: noise, flat blocks (so edges exist) in 8-bit grey.
function fixtureGray(random, width, height) {
  const gray = new Uint8Array(width * height)
  for (let i = 0; i < gray.length; i += 1) gray[i] = 90 + Math.floor(random() * 40)
  for (let b = 0; b < 14; b += 1) {
    const x0 = Math.floor(random() * width), y0 = Math.floor(random() * height)
    const w = 6 + Math.floor(random() * 50), h = 3 + Math.floor(random() * 30), v = Math.floor(random() * 256)
    for (let y = y0; y < Math.min(height, y0 + h); y += 1) for (let x = x0; x < Math.min(width, x0 + w); x += 1) gray[y * width + x] = v
  }
  return gray
}
// RGBA raster of stroke-like blobs, as a canvas would hand it back.
function fixtureRaster(random, width, rows, strokes) {
  const raw = new Uint8ClampedArray(width * rows * 4)
  for (let s = 0; s < strokes; s += 1) {
    const x0 = 1 + Math.floor(random() * (width * .6)), y0 = 3 + Math.floor(random() * (rows * .7))
    const w = 2 + Math.floor(random() * 30), h = 2 + Math.floor(random() * 14)
    for (let y = y0; y < Math.min(rows, y0 + h); y += 1) {
      for (let x = x0; x < Math.min(width, x0 + w); x += 1) raw[(y * width + x) * 4 + 3] = random() < .08 ? 60 : 255
    }
  }
  return raw
}
const drain = run => { let step; while (!(step = run.next()).done); return step.value }

describe('title-font matcher stays bit-identical to the original search', () => {
  const sizes = [[192, 288], [120, 180], [192, 110]]

  it('builds the same glyph mask and sample points', () => {
    for (let seed = 1; seed <= 12; seed += 1) {
      const random = prng(seed), width = sizes[seed % 3][0], rows = Math.ceil(11 * 5.5) + seed * 9
      const raw = fixtureRaster(random, width, rows, 3 + seed % 6)
      const reference = referenceMask(raw, width, rows), mask = glyphMask(raw, width, rows)
      if (!reference) { expect(mask).toBeNull(); continue }
      expect(mask.width).toBe(reference.width)
      expect(mask.height).toBe(reference.height)
      expect(Array.from(mask.mask)).toEqual(Array.from(reference.mask))
      for (const key of ['perimeter', 'foreground', 'background']) {
        expect(Array.from(mask[key])).toEqual(reference[key].map(([x, y]) => y * width + x))
      }
    }
    expect(glyphMask(new Uint8ClampedArray(40 * 20 * 4), 40, 20)).toBeNull()
  })

  it('scores every placement exactly like the original', () => {
    let compared = 0
    for (let seed = 1; seed <= 24; seed += 1) {
      const random = prng(seed * 7919), [width, height] = sizes[seed % 3]
      const gray = fixtureGray(random, width, height), edges = referenceEdgeMap(gray, width, height)
      const workHeight = Math.floor(height * .82), rows = Math.ceil([11, 16, 22, 29][seed % 4] * 5.5)
      const raw = fixtureRaster(random, width, rows, 4 + seed % 5)
      const reference = referenceMask(raw, width, rows), mask = glyphMask(raw, width, rows)
      if (!reference || mask.width > width - 2 || mask.height > workHeight - 8) continue
      const score = drain(scoreFontMask(gray, nearEdgeMap(edges, width), width, height, workHeight, mask))
      expect(score).toBe(referenceScore(gray, edges, width, height, workHeight, reference))
      compared += 1
    }
    expect(compared).toBeGreaterThan(10)
  })

  it('near-edge map equals the five-way max, NaN where the original reads past the array', () => {
    const edges = Float32Array.from({ length: 6 * 5 }, (_, i) => (i * 37) % 255), near = nearEdgeMap(edges, 6)
    for (let at = 0; at < edges.length; at += 1) {
      expect(near[at]).toBe(Math.max(edges[at], edges[at - 1], edges[at + 1], edges[at - 6], edges[at + 6]))
    }
  })

  it('hands the thread back between slices without changing the result', async () => {
    function* counting() { let total = 0; for (let i = 0; i < 6; i += 1) { total += i; yield } return total }
    expect(drain(counting())).toBe(15)
    // Zero budget: every safe point yields, so the run cannot finish synchronously.
    let finished = false
    const sliced = runInSlices(counting(), 0).then(value => { finished = true; return value })
    expect(finished).toBe(false)
    expect(await sliced).toBe(15)
    // A generous budget never yields: only microtasks separate it from the end.
    expect(await runInSlices(counting(), 60_000)).toBe(15)
  })
})

describe('cover analysis is single-flight', () => {
  const realImage = globalThis.Image, realCreate = document.createElement.bind(document)
  afterEach(() => { globalThis.Image = realImage; document.createElement = realCreate; vi.restoreAllMocks() })

  it('searches one cover at a time even when many are requested together', async () => {
    const drawn = []
    globalThis.Image = class {
      constructor() { this.naturalWidth = 192; this.naturalHeight = 288 }
      decode() { return Promise.resolve() }
      set src(value) { this.url = value }
    }
    document.createElement = tag => {
      if (tag !== 'canvas') return realCreate(tag)
      const context = {
        drawImage() {}, clearRect() {}, fillText(text) { drawn.push(text) },
        measureText: text => ({ width: text.length * 5 }),
        getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4).fill(120) })
      }
      return { width: 0, height: 0, getContext: () => context }
    }
    const titles = ['Alpha beta gamma', 'Delta epsilon zeta', 'Eta theta iota']
    const results = await Promise.all(titles.map(title => analyzeCoverAppearance(`blob:${title}`, title)))
    expect(results.every(result => result?.fontFamily)).toBe(true)
    // The lettering of each cover is drawn in one unbroken run: no interleaving.
    const order = drawn.map(text => text.toLowerCase().split(' ')[0])
    expect(order.length).toBeGreaterThan(0)
    expect(order.filter((name, index) => name !== order[index - 1]).length).toBe(titles.length)
  })

  it('reads every canvas it analyses through a CPU-backed context', async () => {
    // getImageData on a GPU-backed 2D canvas forces a readback each time. The
    // lettering search reads one canvas per font candidate and size, which froze
    // the page for seconds (software GL, e.g. just after removing a book).
    const requests = []
    globalThis.Image = class {
      constructor() { this.naturalWidth = 192; this.naturalHeight = 288 }
      decode() { return Promise.resolve() }
      set src(value) { this.url = value }
    }
    document.createElement = tag => {
      if (tag !== 'canvas') return realCreate(tag)
      let reads = false
      const context = {
        drawImage() {}, clearRect() {}, fillText() {},
        measureText: text => ({ width: text.length * 5 }),
        getImageData: (x, y, w, h) => { reads = true; return { data: new Uint8ClampedArray(w * h * 4).fill(120) } }
      }
      return { width: 0, height: 0, getContext: (type, options) => { requests.push({ options, read: () => reads }); return context } }
    }
    await analyzeCoverAppearance('blob:cpu', 'Alpha beta gamma')
    const reading = requests.filter(request => request.read())
    expect(reading.length).toBeGreaterThan(0)
    expect(reading.every(request => request.options?.willReadFrequently === true)).toBe(true)
  })
})
