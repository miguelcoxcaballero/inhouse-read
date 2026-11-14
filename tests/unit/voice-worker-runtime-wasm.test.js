// @vitest-environment node
// The synthesis worker as it runs today (worker.js start-up + rust-ui voice_worker.rs) against the frozen JavaScript worker
// (helpers/reference-voice-worker.js): the same scripted messages over the same fake ONNX Runtime, phonemizer and Supertonic
// runtime must produce the same calls and the same posted messages, in the same order and at the same microtask.
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createReferenceWorker } from './helpers/reference-voice-worker.js'

const world = vi.hoisted(() => ({ now: null }))
vi.mock('../../src/js/readers/neural-voice/phonemizer.js', () => ({ createPhonemizer: options => world.now.createPhonemizer(options) }))
vi.mock('../../src/js/readers/neural-voice/supertonic-runtime.js', () => ({ createSupertonicRuntime: options => world.now.createSupertonicRuntime(options) }))
vi.mock('../../src/js/readers/neural-voice/task-yield.js', () => ({ yieldToMessages: () => world.now.yieldToMessages() }))

const ORT = pathToFileURL(resolve('tests/unit/fixtures/neural-ort') + '/').href
const digest = values => `${values.constructor.name}(${values.length}):${createHash('sha1').update(new Uint8Array(values.buffer, values.byteOffset, values.byteLength)).digest('hex').slice(0, 12)}`
// (a failed import names the importing file, which is the one thing the two workers must differ in)
const firstLine = value => String(value).split('\n')[0].replace(/ imported from .*$/, '')
// A message as the page would see it: key order, numbers as they are, audio by its digest, failures by their first line.
const show = value => {
  if (ArrayBuffer.isView(value)) return digest(value)
  if (Array.isArray(value)) return value.map(show)
  if (value && typeof value === 'object') return Object.entries(value).map(([key, item]) => [key, key === 'error' ? firstLine(item) : show(item)])
  return typeof value === 'number' && Number.isNaN(value) ? 'NaN' : value
}

// A tiny graph whose duration tensor ('b') the worker exposes as a second output (see piper-alignment.test.js).
const encode = new TextEncoder()
const field = (n, bytes) => [n * 8 + 2, bytes.length, ...bytes]
const str = (n, s) => field(n, encode.encode(s))
const node = (op, input, output) => field(1, [...str(1, input), ...str(2, output), ...str(4, op)])
const durationModel = () => Uint8Array.from(field(7, [...node('Ceil', 'a', 'b'), ...node('CumSum', 'b', 'c'),
  ...['input', 'input_lengths', 'scales'].flatMap(n => field(11, str(1, n))), ...field(12, str(1, 'audio'))])).buffer

function makeWorld() {
  const log = [], waiting = new Map(), flags = { hold: new Set(), fail: new Set(), sid: false }
  let clock = 0
  const note = (...event) => { log.push(event) }
  // A fake's answer: at once, held until the script opens it, or a failure.
  const answer = (kind, value) => {
    const failed = flags.fail.delete(kind)
    if (!flags.hold.has(kind)) return failed ? Promise.reject(new Error(`${kind} failed`)) : Promise.resolve(value)
    return new Promise((done, fail) => { if (!waiting.has(kind)) waiting.set(kind, []); waiting.get(kind).push(() => failed ? fail(new Error(`${kind} failed`)) : done(value)) })
  }
  const ids = text => text.split(/(?<=[.!?])\s+/).flatMap(part => /[\p{L}\p{N}]/u.test(part) ? [1, 0, ...[...part].flatMap(char => [3 + char.codePointAt(0) % 40, 0]), 2] : [])
  const wave = (length, scale) => Float32Array.from({ length }, (_, i) => Math.sin(i / 9) * scale)
  const session = name => ({
    inputNames: flags.sid ? ['input', 'input_lengths', 'scales', 'sid'] : ['input', 'input_lengths', 'scales'], outputNames: ['output'],
    release() { note('session.release', name); return answer('release') },
    run(feeds) {
      note('session.run', name, Object.entries(feeds).map(([key, tensor]) => [key, tensor.type, Array.from(tensor.data, String), tensor.dims]))
      const count = feeds.input.data.length
      const out = { output: { data: wave(900 + count * 40, .2), dispose() { note('dispose', 'output') } } }
      if (name === 'durations') out.b = { data: Float32Array.from({ length: count }, (_, i) => 2 + i % 3), dispose() { note('dispose', 'b') } }
      return answer('run', out)
    }
  })
  return {
    log, flags, note,
    clock: () => ++clock,
    open(kind) { const next = waiting.get(kind)?.shift(); if (next) next(); return !!next },
    pending: () => [...waiting.values()].some(list => list.length),
    kinds: () => [...waiting.keys()],
    createPhonemizer(options) {
      note('phonemizer.create', show(options))
      return answer('phon', { phonemize(text, voice) { note('phonemize', text, voice); return answer('phonemize', ids(text)) }, destroy() { note('phonemizer.destroy') } })
    },
    createSupertonicRuntime(options) {
      note('supertonic.create', Object.keys(options), show(options.config), show(options.indexer), show(options.styles))
      return answer('runtime', {
        synthesize(text, options) {
          note('synthesize', text, Object.keys(options), options.lang, options.style, options.rate, show(options.marks), options.isActive())
          const pcm = text.includes('NaN') ? Float32Array.of(.1, NaN) : /[\p{L}\p{N}]/u.test(text) ? wave(700 + text.length * 30, .25) : new Float32Array()
          return answer('synthesize', text.includes('mark') ? { pcm, sampleRate: 24000, marks: [{ offset: 2, sample: 40, extra: 'kept' }] } : { pcm, sampleRate: 24000 })
        },
        dispose() { note('supertonic.dispose'); return flags.hold.has('release') ? answer('release') : undefined }
      })
    },
    yieldToMessages() { note('yield'); return answer('yield') },
    createSession(bytes, options) {
      note('ort.create', bytes.length, show(options))
      return answer('create', session(bytes.length > 8 ? 'durations' : 'plain'))
    }
  }
}

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

/** Runs `script` on one of the two workers and returns everything that happened, with the microtask of each step. */
async function play(live, script) {
  const w = world.now = makeWorld(), ticks = []
  vi.stubGlobal('__neuralOrt', { create: (...args) => w.createSession(...args) })
  vi.spyOn(performance, 'now').mockImplementation(() => w.clock())
  const scope = { crossOriginIsolated: false, postMessage: (message, transfer) => w.note('post', show(message), transfer.map(buffer => buffer === message.pcm?.buffer ? 'pcm.buffer' : 'other')) }
  if (live) { vi.resetModules(); vi.stubGlobal('self', scope); await import('../../src/js/readers/neural-voice/worker.js') }
  else createReferenceWorker(scope, { createPhonemizer: o => w.createPhonemizer(o), createSupertonicRuntime: o => w.createSupertonicRuntime(o), yieldToMessages: () => w.yieldToMessages() })
  const trace = async (count = 40) => { for (let i = 0; i < count; i++) { await Promise.resolve(); ticks.push(w.log.length) } }
  // When the handler's own promise settles is kept apart: a worker's caller never sees it, and where the handler waits for
  // the voice module's promise it settles one microtask later than the JavaScript did.
  const handled = []
  const send = message => scope.onmessage({ data: message }).then(() => { handled.push(message.id) })
  let started = null
  for (const [kind, value] of script) {
    w.note('step', kind)
    if (kind === 'send') { send(value()); await trace() }
    else if (kind === 'await') await send(value())          // real tasks (the dynamic import of init): no microtask trace
    else if (kind === 'start') started = send(value())
    else if (kind === 'join') await started
    else if (kind === 'open') { w.open(value); await trace() }
    else if (kind === 'open!') w.open(value)                // while real tasks are pending: no microtask trace
    else if (kind === 'hold') w.flags.hold.add(value)
    else if (kind === 'flow') w.flags.hold.delete(value)
    else if (kind === 'fail') w.flags.fail.add(value)
    else if (kind === 'sid') w.flags.sid = value
  }
  w.note('step', 'settle')
  w.flags.hold.clear()
  for (let quiet = 0; quiet < 3;) { const before = w.log.length; for (const kind of w.kinds()) while (w.open(kind)); await trace(60); quiet = w.log.length === before && !w.pending() ? quiet + 1 : 0 }
  send({ type: 'free', id: 9000 }); await trace(80)
  return { log: w.log, ticks, handled }
}
async function both(script) {
  const reference = await play(false, script), live = await play(true, script)
  expect(live.log).toEqual(reference.log)
  expect(live.handled).toEqual(reference.handled)
  // The microtask at which each event happened, next to the event so that a difference names it.
  const arrivals = run => run.log.map((event, index) => `${run.ticks.findIndex(count => count > index)} ${JSON.stringify(event).slice(0, 110)}`)
  expect(arrivals(live)).toEqual(arrivals(reference))
  return live.log
}

const init = (extra = {}) => () => ({ type: 'init', id: 1, ortBase: ORT, phonBase: 'https://test/phon/', ...extra })
const piperConfig = extra => ({ audio: { sample_rate: 22050 }, espeak: { voice: 'en-us' }, ...extra })
const loads = {
  piper: id => () => ({ type: 'load', id, voice: 'en_US-test-medium', config: piperConfig(), model: new ArrayBuffer(8) }),
  durations: id => () => ({ type: 'load', id, voice: 'no_NO-nvcc-medium', config: piperConfig({ inference: { noise_scale: .5, length_scale: 1.1, noise_w: .7 }, num_symbols: 30 }), model: durationModel() }),
  hebrew: id => () => ({ type: 'load', id, voice: 'he_IL-test', config: piperConfig({ phoneme_type: 'hebrew', phoneme_id_map: { _: [0], '^': [1], $: [2], a: [5] } }), model: new ArrayBuffer(8), phonemizerModel: new ArrayBuffer(4) }),
  supertonic: id => () => ({ type: 'load', id, voice: 'supertonic3', config: { runtime: 'supertonic3', config: { test: true }, indexer: [1, 2], styles: { F1: { test: true } } }, buffers: { vocoder: new ArrayBuffer(8) } }),
  broken: id => () => ({ type: 'load', id, voice: 'none' })
}
const TEXTS = ['One quiet reader.', 'First part. Second part! Third?', '...', 'A mark here.', 'NaN', '♥', 'Hola 😀 mundo.', '']
const synth = (id, text, extra = {}) => () => ({ type: 'synth', id, text, rate: 1, ...extra })
const posts = log => log.filter(event => event[0] === 'post').map(event => Object.fromEntries(event[1]))

describe('the synthesis worker in the voice module against the frozen JavaScript worker', () => {
  it('answers what arrives before init without loading anything, then initializes', async () => {
    const log = await both([['send', () => ({ type: 'free', id: 2 })], ['send', synth(3, 'Early.')], ['send', loads.piper(4)], ['send', () => ({ type: 'cancel', id: 3 })],
      ['send', () => ({ type: 'unknown', id: 5 })], ['await', init()], ['send', loads.piper(6)], ['send', synth(7, TEXTS[0])]])
    expect(posts(log).map(message => [message.type, message.id])).toEqual([['freed', 2], ['error', 3], ['error', 4], ['ready', 1], ['loaded', 6], ['plan', 7], ['chunk', 7], ['end', 7], ['freed', 9000]])
  })

  it('reports an initialization that fails, retries it, and releases one that was freed meanwhile', async () => {
    await both([['await', init({ ortBase: 'file:///missing-worker-fixture/' })], ['await', init()], ['send', loads.piper(2)], ['send', synth(3, TEXTS[1])]])
    const log = await both([['hold', 'phon'], ['start', init()], ['await', () => ({ type: 'free', id: 8 })], ['open!', 'phon'], ['join'], ['flow', 'phon'], ['await', init({ id: 9 })]])
    expect(posts(log).map(message => [message.type, message.id])).toEqual([['freed', 8], ['error', 1], ['ready', 9], ['freed', 9000]])
  })

  it('posts the same receipts when the diagnostic bridge asks for them', async () => {
    const log = await both([['await', init({ diagnostics: true })], ['sid', true], ['send', loads.durations(2)], ['send', synth(3, TEXTS[1], { speaker: 3, marks: [5, 14, 14, 40] })],
      ['send', loads.supertonic(4)], ['send', synth(5, 'A mark here.', { lang: 'en', style: 'F1', marks: [2] })]])
    expect(posts(log).filter(message => message.type === 'stage' && message.id === 3).map(message => message.stage)).toEqual([1, 2, 3, 4, 5, 6, 3, 4, 5, 6, 3, 4, 5, 6, 7])
    // The model's own durations placed the page boundaries: the chunks carry marks.
    expect(posts(log).filter(message => message.type === 'chunk' && message.id === 3).flatMap(message => message.marks).length).toBeGreaterThan(0)
  })

  it('creates the Piper session without the memory arena and the memory-pattern planner, on the single-threaded provider', async () => {
    const log = await both([['await', init()], ['send', loads.piper(2)]])
    expect(log.find(event => event[0] === 'ort.create')[2]).toEqual([['executionProviders', ['wasm']], ['graphOptimizationLevel', 'all'], ['enableCpuMemArena', false], ['enableMemPattern', false]])
  })

  it('loads, switches, fails and frees every runtime family alike', async () => {
    await both([['await', init()], ['send', loads.piper(2)], ['send', loads.supertonic(3)], ['send', loads.hebrew(4)], ['send', synth(5, 'שלום.')], ['send', loads.broken(6)],
      ['fail', 'create'], ['send', loads.piper(7)], ['fail', 'runtime'], ['send', loads.supertonic(8)], ['fail', 'release'], ['send', loads.piper(9)], ['send', loads.durations(10)],
      ['send', () => ({ type: 'free', id: 11 })], ['send', synth(12, 'Nothing loaded.')], ['send', loads.supertonic(13)], ['hold', 'release'], ['send', loads.piper(14)], ['open', 'release']])
    await both([['await', init({ runtime: 'supertonic3' })], ['send', loads.supertonic(2)], ['send', synth(3, 'Hola.', { lang: 'es', style: 'F1', rate: 1.25 })], ['fail', 'phon'], ['send', loads.piper(4)], ['send', loads.piper(5)], ['send', synth(6, TEXTS[0])]])
  })

  it('queues, cancels, retransmits and frees around running work alike', async () => {
    await both([['await', init()], ['send', loads.piper(2)], ['hold', 'run'], ['send', synth(3, TEXTS[1])], ['send', synth(3, 'Duplicate.')], ['send', synth(4, TEXTS[0])], ['send', synth(1.5, 'Bad id.')],
      ['send', synth('x', 'Bad id.')], ['send', () => ({ type: 'cancel', id: 4 })], ['send', () => ({ type: 'cancel', id: '3' })], ['open', 'run'], ['send', () => ({ type: 'free', id: 6 })],
      ['send', loads.supertonic(7)], ['open', 'run'], ['open', 'run'], ['flow', 'run']])
    await both([['await', init()], ['send', loads.supertonic(2)], ['hold', 'synthesize'], ['send', synth(3, 'Primero.', { lang: 'es', style: 'F1' })], ['send', synth(4, 'Cancelado.')], ['send', synth(5, 'Segundo.')],
      ['send', () => ({ type: 'cancel', id: 4 })], ['send', () => ({ type: 'cancel', id: 3 })], ['send', loads.piper(6)], ['open', 'synthesize'], ['open', 'synthesize']])
    await both([['await', init()], ['send', loads.piper(2)], ['hold', 'phonemize'], ['send', synth(3, '...')], ['send', () => ({ type: 'cancel', id: 3 })], ['open', 'phonemize'], ['fail', 'phonemize'], ['send', synth(4, TEXTS[0])],
      ['open', 'phonemize'], ['flow', 'phonemize'], ['fail', 'run'], ['send', synth(5, TEXTS[1])], ['hold', 'yield'], ['send', synth(6, TEXTS[1])], ['open', 'yield'], ['send', () => ({ type: 'cancel', id: 6 })], ['open', 'yield']])
  })

  it('agrees on generated scripts of loads, jobs, cancellations, holds and failures', async () => {
    let seed = 20261114
    const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32
    const pick = list => list[Math.floor(random() * list.length)]
    const kinds = ['run', 'phonemize', 'synthesize', 'create', 'runtime', 'release', 'yield', 'phon']
    const seen = new Set()
    for (let round = 0; round < 400; round++) {
      const script = [['await', init(random() < .3 ? { diagnostics: true } : random() < .2 ? { runtime: 'supertonic3' } : {})]]
      let id = 10
      for (let step = 0, steps = 6 + Math.floor(random() * 14); step < steps; step++) {
        const roll = random()
        if (roll < .2) script.push(['send', loads[pick(['piper', 'piper', 'durations', 'supertonic', 'hebrew', 'broken'])](++id)])
        else if (roll < .55) {
          const text = pick(TEXTS), extra = { rate: pick([1, 1.25, .8, 2]), ...(random() < .4 ? { marks: [3, 9, 9, 200] } : {}), ...(random() < .3 ? { speaker: pick([0, 2, '1']) } : {}), ...(random() < .4 ? { lang: 'es', style: 'F1' } : {}) }
          script.push(['send', synth(random() < .12 ? pick([1.5, 'x', NaN, id]) : ++id, text, extra)])
        }
        else if (roll < .65) { const target = 11 + Math.floor(random() * Math.max(1, id - 10)); script.push(['send', () => ({ type: 'cancel', id: target })]) }
        else if (roll < .72) script.push(['send', () => ({ type: 'free', id: 700 + step })])
        else if (roll < .82) script.push(['hold', pick(kinds)])
        else if (roll < .92) script.push(['open', pick(kinds)])
        else if (roll < .96) script.push(['fail', pick(kinds)])
        else if (roll < .98) script.push(['sid', random() < .5])
        else script.push(['send', init({ id: 800 + step })])
      }
      for (const message of posts(await both(script))) seen.add(message.type)
    }
    expect([...seen].sort()).toEqual(['chunk', 'end', 'error', 'freed', 'loaded', 'plan', 'ready', 'stage'])
  }, 240000)
  // VOICE_WORKER_BENCH=1 npx vitest run tests/unit/voice-worker-runtime-wasm.test.js -t "measures"
  it.skipIf(!process.env.VOICE_WORKER_BENCH)('measures a synthesis job against the JavaScript worker', async () => {
    const median = values => values.slice().sort((a, b) => a - b)[values.length >> 1]
    const text = 'First part of it. Second part of it! And a third one?', jobs = 300
    // The model's audio is made once per length: what is timed is the worker around the model, not the fake.
    const made = new Map(), audio = length => made.get(length) || made.set(length, Float32Array.from({ length }, (_, i) => Math.sin(i / 9) * .2)).get(length)
    async function worker(live) {
      const w = world.now = makeWorld()
      vi.stubGlobal('__neuralOrt', { create: async () => ({ inputNames: ['input', 'input_lengths', 'scales'], outputNames: ['output'], release: async () => {},
        run: async feeds => ({ output: { data: audio(22050 + feeds.input.data.length * 900), dispose() {} } }) }) })
      let ended
      const scope = { crossOriginIsolated: false, postMessage: message => { if (message.type === 'end' || message.type === 'error') ended(message) } }
      if (live) { vi.resetModules(); vi.stubGlobal('self', scope); await import('../../src/js/readers/neural-voice/worker.js') }
      else createReferenceWorker(scope, { createPhonemizer: o => w.createPhonemizer(o), createSupertonicRuntime: o => w.createSupertonicRuntime(o), yieldToMessages: () => Promise.resolve() })
      await scope.onmessage({ data: init()() }); await scope.onmessage({ data: loads.piper(2)() })
      return async () => {
        world.now = w
        const start = process.hrtime.bigint()
        for (let id = 10; id < 10 + jobs; id++) { const done = new Promise(resolve => { ended = resolve }); scope.onmessage({ data: synth(id, text)() }); expect((await done).type).toBe('end') }
        return Number(process.hrtime.bigint() - start) / 1e3 / jobs
      }
    }
    const reference = await worker(false), live = await worker(true), times = { reference: [], live: [] }
    await reference(); await live()
    for (let round = 0; round < 21; round++) { times.reference.push(await reference()); times.live.push(await live()) }
    if (process.env.VOICE_WORKER_BENCH === '2') console.log(times.reference.map(Math.round).join(' '), '|', times.live.map(Math.round).join(' '))
    console.log(`synthesis job of three sentences (fake model, about 1.5 s of audio each): JavaScript worker ${median(times.reference).toFixed(1)} us, voice module ${median(times.live).toFixed(1)} us (medians of 21 interleaved rounds of ${jobs} jobs)`)
  }, 600000)
})
