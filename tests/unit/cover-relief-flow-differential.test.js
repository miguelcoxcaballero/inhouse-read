import { afterEach, describe, expect, it, vi } from 'vitest'
// The cover relief's browser wrapper (decode, rasters, thumbnails, analyzeCoverRelief, buildReliefMaps,
// updateReliefMapStrengths) is rust-ui/src/relief_flow.rs. This suite runs it and the frozen JavaScript it
// replaced (helpers/reference-cover-relief-flow.js) through the same scripted browser and compares everything
// either one does to it: every host call with its arguments, in order, with the microtask generation it
// happened in, and the generation and value of the answer. An answer one promise job early or late, a
// listener left on a signal, a timer not cleared or a canvas call out of turn fails.
//
// The slice driver is replaced by one that pauses every second step on a microtask, so a run is the same
// sequence of promise jobs every time; the clock is a counter.
vi.mock('../../src/js/cover-appearance.js', async original => ({ ...(await original()),
  runInSlices: async (task, _budget, onSlice) => {
    let steps = 0
    for (let step = task.next(); ; step = task.next()) {
      if (step.done) { onSlice?.(.5); return step.value }
      if (++steps % 2 === 0) { onSlice?.(.5); await null }
    }
  } }))

const production = await import('../../src/js/cover-relief.js')
const frozen = await import('./helpers/reference-cover-relief-flow.js')

const hash = view => { let value = 2166136261; const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength); for (let i = 0; i < bytes.length; i++) value = Math.imul(value ^ bytes[i], 16777619); return value >>> 0 }
const brief = (value, depth = 0) => {
  if (ArrayBuffer.isView(value)) return `${value.constructor.name}(${value.length})#${hash(value)}`
  if (typeof value === 'function') return 'function'
  if (value instanceof Error) return `${value.name}: ${value.message}`
  if (Array.isArray(value)) return value.map(entry => brief(entry, depth + 1))
  if (value && typeof value === 'object') {
    if (value.tag) return value.tag
    if (depth > 6) return 'deep'
    return Object.fromEntries(Object.keys(value).map(key => [key, brief(value[key], depth + 1)]))
  }
  return value
}

/** A scripted browser: globals that log with the microtask generation, and timers fired by hand. */
function browser(script = {}) {
  const log = [], timers = new Map(), images = [], world = { log, generation:0, images, timers }
  let canvases = 0, timerIds = 0, clock = 0
  const note = (...entry) => { log.push([world.generation, ...entry.map(value => brief(value))]) }
  const canvas = () => {
    const tag = `canvas#${++canvases}`, size = { width:0, height:0 }
    let drawn = null
    const context = {
      tag:`${tag}.context`,
      set imageSmoothingEnabled(value) { note(tag, 'imageSmoothingEnabled=', value) },
      set imageSmoothingQuality(value) { note(tag, 'imageSmoothingQuality=', value) },
      drawImage(image, ...rest) { drawn = image; note(tag, 'drawImage', image, ...rest) },
      putImageData(...args) { note(tag, 'putImageData', ...args) },
      getImageData(x, y, width, height) {
        note(tag, 'getImageData', x, y, width, height)
        if (script.sealed) throw new Error('tainted')
        const data = new Uint8ClampedArray(width * height * 4)
        for (let row = 0; row < height; row++) for (let column = 0; column < width; column++) {
          const at = (row * width + column) * 4, band = row * 3 < height ? [192, 32, 48] : row * 3 < height * 2 ? [24, 88, 192] : [240, 240, 240]
          const ink = column > width / 4 && column < width / 2 && row % 5 < 2 ? [20, 20, 20] : band
          data[at] = ink[0]; data[at + 1] = ink[1]; data[at + 2] = ink[2]; data[at + 3] = column === 0 ? 0 : 255
        }
        return { data }
      }
    }
    return {
      tag,
      get width() { return size.width }, set width(value) { note(tag, 'width=', value); size.width = value },
      get height() { return size.height }, set height(value) { note(tag, 'height=', value); size.height = value },
      getContext(...args) { note(tag, 'getContext', ...args); return script.noContext === canvases ? null : context },
      toDataURL(...args) { note(tag, 'toDataURL', ...args, drawn); return `data:image/jpeg;${tag}` }
    }
  }
  const document = { createElement(name) { note('document', 'createElement', name); if (script.noCanvas) throw new Error('no canvas'); return canvas() } }
  class ScriptedImage {
    constructor() {
      this.tag = `image#${images.push(this)}`; note(this.tag, 'new')
      this.naturalWidth = script.natural?.[0] ?? 48; this.naturalHeight = script.natural?.[1] ?? 64
      if (script.decode === 'absent') Object.defineProperty(this, 'decode', { value:undefined })
      let onload = null, onerror = null
      Object.defineProperties(this, {
        onload:{ get:() => onload, set:value => { note(this.tag, 'onload=', value); onload = value } },
        onerror:{ get:() => onerror, set:value => { note(this.tag, 'onerror=', value); onerror = value } } })
    }
    set decoding(value) { note(this.tag, 'decoding=', value) }
    set src(value) { note(this.tag, 'src=', value) }
    decode() {
      note(this.tag, 'decode')
      if (script.decode === 'throws') throw new Error('decode threw')
      if (script.decode === 'rejects') return Promise.reject(new Error('broken'))
      if (script.decode === 'never') return new Promise(() => {})
      return Promise.resolve()
    }
  }
  class ScriptedImageData { constructor(data, width, height) { note('ImageData', 'new', data, width, height); this.data = data; this.width = width; this.height = height } }
  vi.stubGlobal('document', document)
  if (script.noImage) vi.stubGlobal('Image', undefined); else vi.stubGlobal('Image', ScriptedImage)
  vi.stubGlobal('ImageData', ScriptedImageData)
  vi.stubGlobal('setTimeout', (run, delay) => { const id = ++timerIds; note('setTimeout', delay); timers.set(id, run); return id })
  vi.stubGlobal('clearTimeout', id => { note('clearTimeout', id); timers.delete(id) })
  vi.spyOn(performance, 'now').mockImplementation(() => (clock += .25))
  /** A signal that logs what is asked of it; `abort()` runs the listeners the way the platform does. */
  world.signal = (aborted = false) => {
    const listeners = new Set()
    const signal = { tag:'signal',
      get aborted() { note('signal', 'aborted?', aborted); return aborted },
      addEventListener(kind, listener, options) { note('signal', 'addEventListener', kind, options); listeners.add(listener) },
      removeEventListener(kind, listener) { note('signal', 'removeEventListener', kind, listeners.has(listener) ? 'the listener' : listener); listeners.delete(listener) },
      abort() { aborted = true; note('signal', 'abort', listeners.size); for (const listener of [...listeners]) { listeners.delete(listener); listener({ type:'abort' }) } },
      listeners }
    return world.lastSignal = signal
  }
  world.fire = () => { for (const [id, run] of [...timers]) { timers.delete(id); note('timer', 'fires', id); run() } }
  return world
}

/** Run one scenario against one implementation. `script.at[generation]` acts on the world at that generation. */
async function play(module, script, act) {
  const world = browser(script)
  let outcome
  const answer = act(module, world)
  Promise.resolve(answer).then(value => { outcome = ['resolved', world.generation, brief(value)] }, error => { outcome = ['rejected', world.generation, brief(error)] })
  let quiet = 0
  for (let generation = 0; generation < 60000 && quiet < 40; generation++) {
    world.generation = generation
    script.at?.[generation]?.(world)
    if (outcome) quiet++
    await null
  }
  const left = { timers:world.timers.size, listeners:world.lastSignal?.listeners.size ?? 0 }
  vi.unstubAllGlobals(); vi.restoreAllMocks()
  return { log:world.log, outcome, left }
}
async function compare(script, act) {
  const before = await play(frozen, script, act), after = await play(production, script, act)
  expect(after.outcome, 'the answer and its microtask').toEqual(before.outcome)
  expect(after.log.length).toBe(before.log.length)
  for (let i = 0; i < before.log.length; i++) expect(after.log[i], `host call ${i}`).toEqual(before.log[i])
  expect(after.left).toEqual(before.left)
  return after
}

const single = { id:'color-1', color:'#c02030', tolerance:6, strength:.75 }
const layered = { layers:[{ id:'color-1', color:'#c02030', tolerance:6, strength:.5 }, { id:'color-2', color:'#1858c0', tolerance:5, strength:1 }] }
const legacy = { id:'foil', strength:.5 }

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('buildReliefMaps', () => {
  it.each([
    ['one colour', single, { maxSize:64 }],
    ['one colour at the default size', single, undefined],
    ['one colour with the selection in alpha', single, { maxSize:96, selectionAlpha:true }],
    ['layers', layered, { maxSize:64, selectionAlpha:true }],
    ['a legacy family record', legacy, { maxSize:64 }],
    ['a truthy non-boolean selectionAlpha', single, { maxSize:64, selectionAlpha:1 }]
  ])('builds the same maps on the same microtask: %s', async (_name, relief, options) => {
    const { outcome, log } = await compare({}, module => module.buildReliefMaps('cover.jpg', relief, options))
    expect(outcome[0]).toBe('resolved')
    expect(outcome[2].normal).toMatch(/^Uint8ClampedArray/)
    expect(log.some(entry => entry[2] === 'getImageData')).toBe(true)
  })
  it('answers null for no relief without touching the page', async () => {
    const { outcome, log } = await compare({}, module => module.buildReliefMaps('cover.jpg', null))
    expect(outcome).toEqual(['resolved', 0, null]); expect(log).toEqual([])
  })
  it('rejects a null options bag as the destructuring did', async () => {
    const { outcome } = await compare({}, module => module.buildReliefMaps('cover.jpg', single, null))
    expect(outcome[0]).toBe('rejected')
  })
  it('draws a decoded drawable without an Image', async () => {
    const drawable = { tag:'bitmap', width:40, height:30 }
    const { outcome, log } = await compare({ noImage:true }, module => module.buildReliefMaps(drawable, single, { maxSize:64 }))
    expect(outcome[0]).toBe('resolved'); expect(log.some(entry => String(entry[1]).startsWith('image#'))).toBe(false)
  })
  it.each([['videoWidth', { tag:'video', naturalWidth:0, videoWidth:32, videoHeight:20, width:1, height:1 }],
    ['displayWidth', { tag:'frame', displayWidth:24, displayHeight:36 }]])('sizes a drawable by %s', async (_name, drawable) => {
    expect((await compare({}, module => module.buildReliefMaps(drawable, single, { maxSize:64 }))).outcome[0]).toBe('resolved')
  })
  it.each([['no Image class', { noImage:true }], ['decode throws', { decode:'throws' }], ['decode rejects', { decode:'rejects' }],
    ['no canvas', { noCanvas:true }], ['no 2D context', { noContext:1 }], ['sealed pixels', { sealed:true }]])('fails the same way: %s', async (_name, script) => {
    const { outcome, left } = await compare(script, module => module.buildReliefMaps('cover.jpg', single, { maxSize:64 }))
    expect(outcome[0]).toBe('rejected'); expect(left.timers).toBe(0)
  })
  it('waits for onload where an image cannot decode, and clears both handlers', async () => {
    const { outcome, log } = await compare({ decode:'absent', at:{ 9:world => world.images[0].onload({}) } }, module => module.buildReliefMaps('cover.jpg', single, { maxSize:64 }))
    expect(outcome[0]).toBe('resolved'); expect(log.filter(entry => entry[2] === 'onload=' || entry[2] === 'onerror=').length).toBe(4)
  })
  it('rejects on onerror', async () => {
    const { outcome } = await compare({ decode:'absent', at:{ 5:world => world.images[0].onerror({}) } }, module => module.buildReliefMaps('cover.jpg', single, { maxSize:64 }))
    expect(outcome).toEqual(['rejected', expect.any(Number), 'Error: No se pudo leer la portada'])
  })
  it('gives up after the four second timer', async () => {
    const { outcome, left } = await compare({ decode:'never', at:{ 11:world => world.fire() } }, module => module.buildReliefMaps('cover.jpg', single, { maxSize:64 }))
    expect(outcome).toEqual(['rejected', expect.any(Number), 'Error: La portada tardó demasiado']); expect(left.timers).toBe(0)
  })
  it('refuses a signal that is already aborted', async () => {
    const { outcome, log } = await compare({}, (module, world) => module.buildReliefMaps('cover.jpg', single, { maxSize:64, signal:world.signal(true) }))
    expect(outcome).toEqual(['rejected', expect.any(Number), 'AbortError: Análisis cancelado']); expect(log.some(entry => entry[1] === 'document')).toBe(false)
  })
  it.each([0, 1, 2, 3, 4, 5, 6, 8, 12, 20, 40, 80])('follows a signal that aborts at generation %i, leaving no listener', async generation => {
    const { outcome, left } = await compare({ decode:generation < 3 ? 'never' : undefined, at:{ [generation]:world => world.lastSignal.abort() } },
      (module, world) => module.buildReliefMaps('cover.jpg', layered, { maxSize:64, signal:world.signal() }))
    if (generation < 9) expect(outcome[0]).toBe('rejected')
    expect(left).toEqual({ timers:0, listeners:0 })
  })
  it('keeps two concurrent builds in the same order', async () => {
    const { outcome } = await compare({}, module => Promise.all([module.buildReliefMaps('a.jpg', single, { maxSize:64 }),
      module.buildReliefMaps('b.jpg', layered, { maxSize:48, selectionAlpha:true }), module.buildReliefMaps('c.jpg', legacy, { maxSize:32 })]))
    expect(outcome[0]).toBe('resolved'); expect(outcome[2]).toHaveLength(3)
  })
})

describe('updateReliefMapStrengths', () => {
  const stronger = { layers:[{ ...layered.layers[0], strength:1 }, { ...layered.layers[1], strength:.25 }] }
  it.each([['with the selection in alpha', true], ['without', false]])('recomposes the same planes on the same microtask: %s', async (_name, selectionAlpha) => {
    const { outcome } = await compare({}, async (module, world) => {
      const built = await module.buildReliefMaps('cover.jpg', layered, { maxSize:64, selectionAlpha })
      world.log.length = 0
      const started = world.generation, next = await module.updateReliefMapStrengths(built, stronger, { signal:world.signal() })
      return { next, generations:world.generation - started, same:next.pixels === built.pixels, kept:next.height === built.height }
    })
    expect(outcome[0]).toBe('resolved'); expect(outcome[2].same).toBe(false); expect(outcome[2].kept).toBe(true)
  })
  it.each([['changed zones', { layers:[{ ...layered.layers[0], color:'#00ff00' }] }], ['no installed maps', null]])('rejects the same way: %s', async (_name, selection) => {
    const { outcome } = await compare({}, async module => {
      const built = selection ? await module.buildReliefMaps('cover.jpg', layered, { maxSize:64 }) : null
      return module.updateReliefMapStrengths(built, selection ?? stronger)
    })
    expect(outcome[0]).toBe('rejected')
  })
})

describe('analyzeCoverRelief', () => {
  it.each([['with previews', undefined], ['without previews', { previews:false }], ['with a signal', 'signal']])('proposes the same colours on the same microtask: %s', async (_name, options) => {
    const { outcome, log } = await compare({}, (module, world) => module.analyzeCoverRelief('cover.jpg', options === 'signal' ? { signal:world.signal(), title:'T' } : options))
    expect(outcome[0]).toBe('resolved'); expect(outcome[2].proposals.length).toBeGreaterThan(1)
    expect(log.some(entry => entry[2] === 'toDataURL')).toBe(options?.previews !== false)
  })
  it.each([3, 30, 200, 600])('follows a signal when the signal aborts at generation %i', async generation => {
    const { outcome, left } = await compare({ at:{ [generation]:world => world.lastSignal.abort() } }, (module, world) => module.analyzeCoverRelief('cover.jpg', { signal:world.signal() }))
    if (generation < 31) expect(outcome[0]).toBe('rejected')
    expect(left.listeners).toBe(0)
  })
  it('fails the same way when a thumbnail has no context', async () => {
    const { outcome } = await compare({ noContext:3 }, module => module.analyzeCoverRelief('cover.jpg'))
    expect(outcome[0]).toBe('rejected')
  })
})
