// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { scoreFontMask } from '../../src/js/font-score-core.js'
// The cover analyser's orchestration is rust-ui/src/cover_appearance.rs. This suite runs it and the frozen
// JavaScript it replaced (helpers/reference-cover-appearance-orchestration.js) through the same scripted
// browser and compares everything either one does to it: every host call with its arguments, in order,
// together with the macrotask it happened in and the microtask generation within that task. An answer
// that arrives one promise job early or late, a font requested out of turn or a timer left behind fails.
vi.mock('../../src/js/rust-shelf.js', async () => (await import('./helpers/rust-shelf-real.js')).rustShelfMock())

const realImmediate = setImmediate
const drain = task => { let step = task.next(); while (!step.done) step = task.next(); return step.value }
const GENERATIONS = 600

/** A scripted browser: globals that log, a virtual clock, and a macrotask queue the test pumps by hand. */
function browser(script = {}) {
  const log = [], tasks = []
  let turn = 0, generation = 0, spinning = false, time = 0, sequence = 0, readies = 0, images = 0, canvases = 0
  const note = (...entry) => { log.push([turn, generation, ...entry]) }
  const later = (delay, run, label) => { const id = ++sequence; tasks.push({ id, due:time + delay, run, label }); return id }
  const brief = value => value instanceof Uint8Array || value instanceof Uint8ClampedArray || value instanceof Float32Array || value instanceof Int32Array
    ? `${value.constructor.name}(${value.length})` : typeof value === 'function' ? 'function' : value && typeof value === 'object'
      ? (value.tag || JSON.stringify(value, (key, inner) => ArrayBuffer.isView(inner) ? `${inner.constructor.name}(${inner.length})` : inner)) : value
  const listeners = new Set()
  const canvas = () => {
    const tag = `canvas#${++canvases}`, size = { width:0, height:0 }
    let contexts = 0
    const context = {
      tag:`${tag}.context`, image:false,
      drawImage(image, ...rest) { this.image = true; note(tag, 'drawImage', brief(image), ...rest) },
      clearRect(...args) { note(tag, 'clearRect', ...args) },
      measureText(text) { note(tag, 'measureText', text); return { width:String(text).length * (script.glyphWidth ?? 3) } },
      fillText(...args) { note(tag, 'fillText', ...args, this.font, this.textAlign, this.textBaseline, this.fillStyle) },
      getImageData(x, y, width, height) {
        note(tag, 'getImageData', x, y, width, height)
        if (script.sealed && this.image) throw new Error('tainted')
        if (script.rasterFails && !this.image && script.rasterFails === ++this.reads) throw new Error('raster lost')
        const data = new Uint8ClampedArray(width * height * 4)
        if (this.image) for (let i = 0; i < data.length; i += 4) { data[i] = 80 + (i / 4) % 7; data[i + 1] = 120; data[i + 2] = 200 - (i / 4) % 11; data[i + 3] = 255 }
        else for (let row = 3; row < 17; row++) for (let column = 3; column < 15; column++) if (column < 7 || row < 7 || ((column + row) % 4 === 0)) data[(row * width + column) * 4 + 3] = 255
        return { data }
      },
      reads:0
    }
    return {
      tag,
      get width() { return size.width }, set width(value) { note(tag, 'width=', value); size.width = value },
      get height() { return size.height }, set height(value) { note(tag, 'height=', value); size.height = value },
      getContext(...args) {
        note(tag, 'getContext', ...args.map(brief))
        if (script.noContext?.includes(canvases * 10 + ++contexts)) return null
        return context
      }
    }
  }
  const document = {
    createElement(name) { note('document', 'createElement', name); if (name !== 'canvas') throw new Error('Unexpected node'); return canvas() },
    get visibilityState() {
      const hidden = script.hideAt === ++readies
      note('document', 'visibilityState', hidden ? 'hidden' : 'visible')
      if (hidden) later(0, () => { script.hideAt = 0; for (const listener of [...listeners]) listener() }, 'visible again')
      return hidden ? 'hidden' : 'visible'
    },
    addEventListener(kind) { note('document', 'addEventListener', kind); listeners.add(arguments[1]) },
    removeEventListener(kind) { note('document', 'removeEventListener', kind); listeners.delete(arguments[1]) }
  }
  if (script.fonts !== false) document.fonts = { load(...args) { note('fonts', 'load', ...args); if (script.fontsThrow) throw new Error('no fonts'); return script.fontsReject ? Promise.reject(new Error('font')) : Promise.resolve([]) } }
  class ScriptedImage {
    constructor() {
      this.tag = `image#${++images}`; note(this.tag, 'new')
      this.naturalWidth = script.natural?.[0] ?? 64; this.naturalHeight = script.natural?.[1] ?? 80
      if (script.decode === 'absent') {
        Object.defineProperty(this, 'decode', { value:undefined })
        later(0, () => { note(this.tag, script.loadFails ? 'onerror' : 'onload'); (script.loadFails ? this.onerror : this.onload)?.(script.loadFails ? new Error('broken') : {}) }, 'image load')
      }
    }
    set decoding(value) { note(this.tag, 'decoding=', value) }
    set src(value) { note(this.tag, 'src=', value) }
    decode() {
      note(this.tag, 'decode')
      if (script.decode === 'throws') throw new Error('decode threw')
      if (script.decode === 'rejects') return Promise.reject(new Error('broken'))
      if (script.decode === 'never') return new Promise(() => {})
      if (script.decode === 'slow') return new Promise(resolve => later(script.decodeAfter ?? 100, resolve, 'decoded'))
      return Promise.resolve()
    }
  }
  class ScriptedWorker {
    constructor() { note('worker', 'new'); if (script.worker === 'blocked') throw new Error('Worker creation blocked'); this.batches = 0 }
    postMessage(message) {
      const data = structuredClone({ ...message, module:undefined })
      note('worker', 'postMessage', data.type, data.request, data.masks?.length, data.width, data.height, data.rows)
      if (data.type === 'begin') {
        this.context = data
        later(0, () => this.onmessage?.({ data:{ type:'begin', job:data.job, request:data.request, accepted:true } }), 'worker begin')
      } else if (data.type === 'scores') {
        const failing = script.workerFailsAt === ++this.batches
        const { gray, near, width, height, rows } = this.context
        const scores = data.masks.map(mask => drain(scoreFontMask(gray, near, width, height, rows, mask)))
        later(0, () => this.onmessage?.({ data:failing ? { type:'error', job:data.job, request:data.request } : { type:'scores', job:data.job, request:data.request, scores } }), 'worker scores')
      }
    }
    terminate() { note('worker', 'terminate') }
  }
  class ScriptedChannel {
    constructor() {
      const port1 = { close() { note('channel', 'close 1') } }, port2 = { close() { note('channel', 'close 2') }, postMessage(value) { note('channel', 'postMessage', value); later(0, () => port1.onmessage?.({ data:value }), 'message') } }
      this.port1 = port1; this.port2 = port2
    }
  }
  const lifecycle = new EventTarget()
  const globals = {
    Image:script.image === false ? undefined : ScriptedImage, document, Worker:script.worker === 'missing' ? undefined : ScriptedWorker,
    MessageChannel:script.channel === false ? undefined : ScriptedChannel,
    setTimeout:(run, delay = 0) => { const id = later(delay, run, `timeout ${delay}`); note('setTimeout', delay, id); return id },
    clearTimeout:id => { const at = tasks.findIndex(task => task.id === id); note('clearTimeout', id, at >= 0); if (at >= 0) tasks.splice(at, 1) },
    performance:{ now:() => { time += script.tick ?? 0; note('now', time); return time } },
    addEventListener:lifecycle.addEventListener.bind(lifecycle), removeEventListener:lifecycle.removeEventListener.bind(lifecycle),
    dispatchEvent:lifecycle.dispatchEvent.bind(lifecycle)
  }
  // Microtask generations: one self-renewing job counts how many rounds of the queue have run in this task.
  const spin = () => { if (!spinning) return; if (++generation < GENERATIONS) Promise.resolve().then(spin); else spinning = false }
  const settle = async () => {
    generation = 0; spinning = true; Promise.resolve().then(spin)
    await new Promise(resolve => realImmediate(resolve))
    spinning = false
  }
  return {
    log, note,
    /** Runs `start()` to its answer: microtasks to quiescence, then the earliest macrotask, and again. */
    async run(start) {
      for (const [name, value] of Object.entries(globals)) vi.stubGlobal(name, value)
      try {
        const outcomes = []
        let open = 0
        const watch = (promise, name) => { open++; promise.then(value => { note('fulfilled', name, brief(value)); outcomes.push(value); open-- }, error => { note('rejected', name, String(error)); outcomes.push(error); open-- }) }
        let started
        try { started = start() } catch (error) { note('threw', String(error)); return { log, outcomes:[error] } }
        ;(Array.isArray(started) ? started : [started]).forEach((promise, index) => watch(Promise.resolve(promise), index))
        note('returned')
        for (;;) {
          await settle()
          if (!open) break
          if (!tasks.length) { note('stalled'); break }
          const next = tasks.reduce((best, task) => task.due < best.due ? task : best)
          tasks.splice(tasks.indexOf(next), 1)
          turn++; generation = 0; time = Math.max(time, next.due)
          note('task', next.label)
          next.run()
        }
        // The page goes away: the shared Worker is released, so the next run starts from the same state.
        turn++; generation = 0
        globals.dispatchEvent(new Event('pagehide'))
        await settle()
        note('left', tasks.map(task => task.label).join(','))
        return { log, outcomes }
      } finally { vi.unstubAllGlobals() }
    }
  }
}

const modules = {}
async function analysers() {
  // Both analysers reach the Worker client through a dynamic import: have it loaded, so it answers in microtasks.
  await import('../../src/js/font-score-client.js')
  modules.reference ??= await import('./helpers/reference-cover-appearance-orchestration.js')
  if (!modules.candidate) {
    modules.candidate = await import('../../src/js/cover-appearance.js')
    // The first safe point of a page lets the shelf module adopt the start-up state (two handles, once).
    await browser({}).run(() => modules.candidate.analyzeCoverAppearance('blob:first', '', { matchFont:false }))
  }
  return modules
}
/** The same scripted call against the frozen JavaScript and the Rust analyser, logs compared entry by entry. */
async function compare(script, call) {
  const { reference, candidate } = await analysers()
  const expected = await browser(structuredClone(script)).run(() => call(reference))
  const shelf = (await import('../../src/js/rust-shelf.js')).getRustShelf()
  const held = [shelf.shelf_live_handles(), shelf.shelf_pending_callbacks()]
  const actual = await browser(structuredClone(script)).run(() => call(candidate))
  // Whatever happened (a failed search, a rejected decode), the analyser keeps no handle and no callback.
  // One thing waits for the collector instead: the four handles of a released Worker client
  // (rust-ui/src/font_score_client.rs), held by its last job's handle.
  const spare = 4 * actual.log.filter(entry => entry[2] === 'worker' && entry[3] === 'new').length
  expect(shelf.shelf_live_handles() - held[0]).toBeGreaterThanOrEqual(0)
  expect(shelf.shelf_live_handles() - held[0]).toBeLessThanOrEqual(spare)
  expect(shelf.shelf_pending_callbacks()).toBe(held[1])
  expect(actual.log.length).toBe(expected.log.length)
  for (let at = 0; at < expected.log.length; at++) expect(actual.log[at], `entry ${at} after ${JSON.stringify(expected.log[at - 1])}`).toEqual(expected.log[at])
  expect(actual.outcomes).toEqual(expected.outcomes)
  return expected
}
const names = log => log.map(entry => entry.slice(2).join(' '))
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('the Rust cover analyser acts on the same microtask as the frozen JavaScript', () => {
  it('colour only: decode, sample, colour and answer, with no font and no Worker', async () => {
    const { log, outcomes } = await compare({}, module => module.analyzeCoverAppearance('blob:a', 'Alpha beta', { matchFont:false }))
    expect(outcomes[0]).toMatchObject({ aspectRatio:.8, source:'cover' })
    expect(outcomes[0].color).toMatch(/^#[0-9a-f]{6}$/)
    expect(names(log).some(name => name.startsWith('fonts') || name.startsWith('worker'))).toBe(false)
    expect(names(log)).toContain('setTimeout 1200 1')
  })
  it('the full search through the Worker: 144 rasters, six batches, one answer', async () => {
    const { log, outcomes } = await compare({}, module => module.analyzeCoverAppearance('blob:a', 'Alpha beta'))
    expect(outcomes[0].fontFamily).toBeTruthy()
    expect(names(log).filter(name => name.includes('fillText'))).toHaveLength(144)
    expect(names(log).filter(name => name.startsWith('worker postMessage scores'))).toHaveLength(6)
    expect(names(log)).toContain('setTimeout 3000 1')
  })
  it('hands the thread back every 2 ms of rasters and resumes at the same plan', async () => {
    const { log } = await compare({ tick:.7 }, module => module.analyzeCoverAppearance('blob:a', 'Alpha beta'))
    expect(names(log).filter(name => name === 'channel postMessage 0').length).toBeGreaterThan(40)
  })
  it('yields with a timer where there is no MessageChannel', async () => {
    const { log } = await compare({ tick:.9, channel:false }, module => module.analyzeCoverAppearance('blob:a', 'ALPHA BETA'))
    expect(names(log).filter(name => name.startsWith('setTimeout 0')).length).toBeGreaterThan(20)
  })
  for (const worker of ['missing', 'blocked']) it(`scores on the main thread, in slices, with a ${worker} Worker`, async () => {
    const { outcomes } = await compare({ worker, tick:.05 }, module => module.analyzeCoverAppearance('blob:a', 'Alpha beta'))
    expect(outcomes[0].fontFamily).toBeTruthy()
  })
  it('falls back on the same masks when the Worker fails its second batch', async () => {
    const { log } = await compare({ workerFailsAt:2 }, module => module.analyzeCoverAppearance('blob:a', 'Alpha beta'))
    expect(names(log)).toContain('worker terminate')
    expect(names(log).filter(name => name.startsWith('worker postMessage scores'))).toHaveLength(2)
  })
  it('searches one cover at a time when three are asked for together, colour-only ones overtaking', async () => {
    const { outcomes } = await compare({ tick:.3 }, module => [
      module.analyzeCoverAppearance('blob:a', 'Alpha beta'), module.analyzeCoverAppearance('blob:b', 'Delta epsilon', { matchFont:false }),
      module.analyzeCoverAppearance('blob:c', 'GAMMA DELTA'), module.analyzeCoverAppearance('blob:d', 'Eta theta iota') ])
    expect(outcomes).toHaveLength(4)
    expect(outcomes.filter(outcome => outcome.fontFamily)).toHaveLength(3)
  })
  it('a search that fails does not hold the next one back', async () => {
    const { outcomes } = await compare({ rasterFails:5, worker:'missing' }, module => [
      module.analyzeCoverAppearance('blob:a', 'Alpha beta'), module.analyzeCoverAppearance('blob:b', 'Delta epsilon') ])
    expect(outcomes).toContain(null)
  })
  it('requests the unicode subsets only for lettering outside Latin-1', async () => {
    const { log } = await compare({}, module => [module.analyzeCoverAppearance('blob:a', 'Война и мир'), module.analyzeCoverAppearance('blob:b', 'Señor café')])
    expect(names(log).filter(name => name.startsWith('fonts load') && name.includes('Война'))).toHaveLength(6)
    expect(names(log).filter(name => name.startsWith('fonts load') && name.includes('Señor'))).toHaveLength(0)
  })
  it('a short or missing title keeps the first family, or the sans one on a busy cover', async () => {
    await compare({}, module => [module.analyzeCoverAppearance('blob:a', 'Ab'), module.analyzeCoverAppearance('blob:b'), module.analyzeCoverAppearance('blob:c', '   x  '),
      module.analyzeCoverAppearance('blob:d', 0), module.analyzeCoverAppearance('blob:e', null)])
  })
  it('small covers, a missing scratch context and rejected font loads', async () => {
    await compare({ natural:[40, 300] }, module => module.analyzeCoverAppearance('blob:a', 'Alpha beta'))
    await compare({ natural:[300, 40] }, module => module.analyzeCoverAppearance('blob:a', 'Alpha beta'))
    await compare({ noContext:[21] }, module => module.analyzeCoverAppearance('blob:a', 'Alpha beta'))
    await compare({ noContext:[31, 51], worker:'missing' }, module => module.analyzeCoverAppearance('blob:a', 'Alpha beta'))
    await compare({ fontsReject:true }, module => module.analyzeCoverAppearance('blob:a', 'Alpha beta'))
    await compare({ fontsThrow:true }, module => module.analyzeCoverAppearance('blob:a', 'Ünïcode ε title'))
    await compare({ fonts:false }, module => module.analyzeCoverAppearance('blob:a', 'ALPHA'))
  })
  it('decode: rejected, thrown, late, timed out at 3000 and 1200 ms, and an image without decode()', async () => {
    for (const decode of ['rejects', 'throws', 'never', 'slow', 'absent']) for (const matchFont of [true, false]) {
      const { outcomes } = await compare({ decode }, module => module.analyzeCoverAppearance('blob:a', 'Alpha beta', { matchFont }))
      expect(outcomes[0] === null, `${decode} ${matchFont}`).toBe(!['slow', 'absent'].includes(decode))
    }
    await compare({ decode:'slow', decodeAfter:5000 }, module => module.analyzeCoverAppearance('blob:a', 'Alpha beta', { matchFont:false }))
    await compare({ decode:'absent', loadFails:true }, module => module.analyzeCoverAppearance('blob:a', 'Alpha beta'))
  })
  it('an image the caller already decoded is sampled at once, without a timer', async () => {
    const image = { tag:'given', naturalWidth:120, naturalHeight:90, decode() { throw new Error('must not decode') } }
    const { log, outcomes } = await compare({}, module => module.analyzeCoverAppearance('blob:a', 'Alpha beta', { image, matchFont:false }))
    expect(outcomes[0].aspectRatio).toBeCloseTo(120 / 90)
    expect(names(log).some(name => name.startsWith('setTimeout'))).toBe(false)
    await compare({}, module => module.analyzeCoverAppearance('blob:a', 'Alpha beta', { image }))
  })
  it('unreadable pixels, no context, an empty image and missing arguments', async () => {
    expect((await compare({ sealed:true }, module => module.analyzeCoverAppearance('blob:a', 'Alpha beta'))).outcomes[0]).toEqual({ aspectRatio:.8, source:'cover' })
    expect((await compare({ noContext:[11] }, module => module.analyzeCoverAppearance('blob:a', 'Alpha beta'))).outcomes[0]).toEqual({ aspectRatio:.8, source:'cover' })
    expect((await compare({ natural:[0, 80] }, module => module.analyzeCoverAppearance('blob:a', 'Alpha beta'))).outcomes[0]).toBeNull()
    expect((await compare({ natural:[9000, 30] }, module => module.analyzeCoverAppearance('blob:a', 'Alpha beta', { matchFont:false }))).outcomes[0].aspectRatio).toBe(2.5)
    await compare({}, module => [module.analyzeCoverAppearance('', 'Alpha beta'), module.analyzeCoverAppearance(undefined), module.analyzeCoverAppearance('blob:a', undefined, undefined)])
    await compare({ image:false }, module => module.analyzeCoverAppearance('blob:a', 'Alpha beta'))
    const refused = await compare({}, module => module.analyzeCoverAppearance('blob:a', 'Alpha beta', null))
    expect(refused.outcomes[0]).toBeInstanceOf(TypeError)
  })
  it('waits, parked on one listener, while the page is hidden', async () => {
    for (const hideAt of [1, 2, 3, 5, 9, 20]) {
      const { log } = await compare({ hideAt, tick:.6 }, module => module.analyzeCoverAppearance('blob:a', 'Alpha beta'))
      expect(names(log)).toContain('document addEventListener visibilitychange')
    }
    await compare({ hideAt:4, worker:'missing', tick:.2 }, module => module.analyzeCoverAppearance('blob:a', 'ALPHA BETA'))
  })
  it('readCoverAspectRatio: decoded, failed, thrown, timed out at 1500 ms and without decode()', async () => {
    expect((await compare({ natural:[900, 1200] }, module => module.readCoverAspectRatio('blob:a'))).outcomes[0]).toBe(.75)
    for (const decode of ['rejects', 'throws', 'never', 'slow', 'absent']) {
      const { outcomes, log } = await compare({ decode }, module => module.readCoverAspectRatio('blob:a'))
      expect(outcomes[0] === null, decode).toBe(!['slow', 'absent'].includes(decode))
      expect(names(log).some(name => name.startsWith('clearTimeout'))).toBe(true)
    }
    await compare({ decode:'slow', decodeAfter:1500 }, module => module.readCoverAspectRatio('blob:a'))
    await compare({ decode:'absent', loadFails:true }, module => module.readCoverAspectRatio('blob:a'))
    await compare({ image:false }, module => [module.readCoverAspectRatio('blob:a'), module.readCoverAspectRatio('')])
  })
})
