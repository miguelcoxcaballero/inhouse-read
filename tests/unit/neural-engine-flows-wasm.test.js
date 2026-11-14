// @vitest-environment node
// The engine's waiting members as they run today (rust-ui neural_engine_flows.rs: refresh, install, remove, warmUp and the
// preparation of a run) against the same engine with those members as JavaScript (helpers/reference-neural-engine-flows.js):
// the same script over the same fake store, worker client and audio must give the same calls, events and answers, in the
// same order and at the same microtask.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NeuralEngine } from '../../src/js/readers/neural-voice/engine.js'
import { ReferenceNeuralEngine } from './helpers/reference-neural-engine-flows.js'
import { fakeAudioContext, advance } from './neural-fakes.js'

const CLAUDE = 'piper:es_MX-claude-high', SHARVARD_M = 'piper:es_ES-sharvard-medium', SHARVARD_F = 'piper:es_ES-sharvard-medium#1', UNKNOWN = 'piper:xx_XX-nobody-low'
const model = id => id.slice('piper:'.length).replace(/#\d+$/, '')
const show = value => {
  if (value instanceof Set) return ['Set', ...[...value].sort()]
  if (value instanceof Map) return ['Map', ...[...value].map(([key, item]) => [key, show(item)])]
  // install(id, null) is a TypeError in both; the engine's wording of a failed destructuring is the one thing not kept.
  if (value instanceof Error) return ['Error', value.name, value instanceof TypeError ? '' : value.message, value.code]
  if (ArrayBuffer.isView(value)) return [value.constructor.name, value.length]
  if (Array.isArray(value)) return value.map(show)
  if (value && typeof value === 'object') return Object.entries(value).filter(([, item]) => typeof item !== 'function').map(([key, item]) => [key, show(item)])
  return typeof value === 'number' && Number.isNaN(value) ? 'NaN' : value
}

afterEach(() => vi.useRealTimers())

async function play(Engine, { installed = [], legacy = true }, script) {
  vi.useFakeTimers()
  const log = [], ticks = [], waiting = new Map(), hold = new Set(), fail = new Map(), stored = new Set(installed.map(model)), progress = []
  const note = (...event) => { log.push(event) }
  const answer = (kind, value, signal) => {
    const code = fail.get(kind); fail.delete(kind)
    const settle = (done, failed) => code ? failed(Object.assign(new Error(`${kind} ${code}`), { code })) : done(typeof value === 'function' ? value() : value)
    if (!hold.has(kind)) return new Promise(settle)
    return new Promise((done, failed) => {
      if (!waiting.has(kind)) waiting.set(kind, [])
      waiting.get(kind).push(() => settle(done, failed))
      signal?.addEventListener('abort', () => failed(Object.assign(new Error('The download was aborted'), { name: 'AbortError' })))
    })
  }
  const ctx = fakeAudioContext(), env = new EventTarget(), clients = []
  Object.assign(env, { Worker: function () {}, WebAssembly: {}, AudioContext: function () {}, caches: {} })
  const store = {
    download(piperId, options) {
      note('store.download', piperId, Object.keys(options), options.signal.aborted)
      progress.push(options.onProgress)
      return answer('download', () => { stored.add(piperId); return { bytes: 1 } }, options.signal)
    },
    remove(piperId) { note('store.remove', piperId); return answer('remove', () => { stored.delete(piperId) }) }
  }
  if (legacy) store.list = () => { note('store.list'); return answer('list', () => new Set(stored)) }
  else store.listVoices = voices => { note('store.listVoices', voices.length); return answer('list', () => new Set(voices.filter(voice => stored.has(voice.piperId)).map(voice => voice.id))) }
  const createClient = () => {
    const client = {
      disposed: false, jobs: [], get alive() { return !client.disposed },
      prepare(piperId) { note('client.prepare', clients.indexOf(client), piperId); return answer('prepare') },
      synth(request, handlers) { note('client.synth', request.text); const job = { request, handlers, cancel() { note('job.cancel', request.text) } }; client.jobs.push(job); return job },
      dispose() { note('client.dispose', clients.indexOf(client)); client.disposed = true }
    }
    clients.push(client); note('client.create', clients.length - 1)
    return client
  }
  const engine = new Engine({ store, createClient, audio: { context: () => ctx, unlock: () => ctx }, env })
  engine._installed = new Set(installed)
  env.addEventListener('inhouse-tts', event => note('tts', show(event.detail)))
  engine.addEventListener('change', () => note('change', show(engine.installed), show(engine.downloads), [...engine.installing.keys()], [...engine.aborts.keys()]))
  engine.addEventListener('status', () => note('status', engine.status))
  const trace = async (count = 30) => { for (let i = 0; i < count; i++) { await Promise.resolve(); ticks.push(log.length) } }
  const settled = (label, call) => {
    let promise
    try { promise = call() } catch (error) { note('threw', label, show(error)); return }
    note('returned', label, promise instanceof Promise)
    Promise.resolve(promise).then(value => note('resolved', label, show(value)), error => note('rejected', label, show(error)))
    return promise
  }
  const answers = []
  for (const [kind, a, b] of script) {
    note('step', kind, a)
    if (kind === 'refresh') settled('refresh', () => engine.refresh())
    else if (kind === 'install') answers.push(settled(`install ${a}`, () => b === 'none' ? engine.install(a) : b === 'null' ? engine.install(a, null) : engine.install(a, { signal: b === 'aborted' ? AbortSignal.abort() : undefined })))
    else if (kind === 'cancel') engine.cancel(a)
    else if (kind === 'remove') settled(`remove ${a}`, () => engine.remove(a))
    else if (kind === 'warm') settled(`warm ${a}`, () => engine.warmUp(a))
    else if (kind === 'speak') engine.speak({ text: a, voiceId: b, id: a, upcoming: [] })
    else if (kind === 'stop') engine.stop()
    else if (kind === 'release') engine.release()
    else if (kind === 'progress') progress.at(-1)?.({ received: a, total: b })
    else if (kind === 'open') waiting.get(a)?.shift()?.()
    else if (kind === 'hold') hold.add(a)
    else if (kind === 'flow') hold.delete(a)
    else if (kind === 'fail') fail.set(a, b)
    else if (kind === 'feed') { const job = clients.at(-1)?.jobs.at(-1); if (job) { job.handlers.onChunk({ index: 0, last: true, pcm: new Float32Array(11025).fill(.2), sampleRate: 22050, ms: 80 }); job.handlers.onEnd() } }
    else if (kind === 'advance') advance(ctx, a)
    await trace()
  }
  note('step', 'settle')
  hold.clear()
  for (let quiet = 0; quiet < 2;) { const before = log.length; for (const list of waiting.values()) while (list.length) list.shift()(); await trace(40); quiet = log.length === before ? quiet + 1 : 0 }
  // Two installs of one model share the download: the second answer is the first job itself.
  note('same job', answers.length > 1 && answers[0] instanceof Promise && answers[0] === answers[1])
  engine.release(); await trace(20)
  vi.useRealTimers()
  return { log, ticks }
}
async function both(options, script) {
  const reference = await play(ReferenceNeuralEngine, options, script), live = await play(NeuralEngine, options, script)
  expect(live.log).toEqual(reference.log)
  const arrivals = run => run.log.map((event, index) => `${run.ticks.findIndex(count => count > index)} ${JSON.stringify(event).slice(0, 120)}`)
  expect(arrivals(live)).toEqual(arrivals(reference))
  return live.log
}
const has = (log, ...start) => log.some(event => start.every((value, index) => JSON.stringify(event[index]) === JSON.stringify(value)))

describe('the waiting members of the neural engine in Rust against their JavaScript', () => {
  it('refreshes the installed set from either kind of store, and from one that fails', async () => {
    const log = await both({ installed: [], legacy: true }, [['refresh'], ['install', CLAUDE, 'none'], ['refresh'], ['fail', 'list', 'storage'], ['refresh'], ['hold', 'list'], ['refresh'], ['refresh'], ['open', 'list'], ['open', 'list']])
    expect(has(log, 'resolved', 'refresh')).toBe(true)
    await both({ installed: [CLAUDE, SHARVARD_F], legacy: false }, [['refresh'], ['remove', CLAUDE], ['refresh'], ['fail', 'list', 'offline'], ['refresh']])
  })

  it('downloads with progress, shares the download of a model, cancels and fails alike', async () => {
    const log = await both({}, [['hold', 'download'], ['install', SHARVARD_M, 'options'], ['install', SHARVARD_F, 'none'], ['progress', 10, 100], ['progress', 11, 100], ['progress', 60, 100], ['open', 'download'], ['install', SHARVARD_M, 'none']])
    expect(has(log, 'same job', false)).toBe(true) // each call answers with its own promise, as an async method does
    expect(has(log, 'resolved', `install ${SHARVARD_F}`)).toBe(true)
    await both({}, [['hold', 'download'], ['install', CLAUDE, 'none'], ['progress', 5, 0], ['cancel', CLAUDE], ['install', CLAUDE, 'aborted'], ['install', UNKNOWN, 'none'], ['install', CLAUDE, 'null'],
      ['fail', 'download', 'offline'], ['flow', 'download'], ['install', SHARVARD_F, 'options'], ['fail', 'download', 'http'], ['install', SHARVARD_F, 'options'], ['install', SHARVARD_F, 'options'], ['remove', SHARVARD_M], ['remove', UNKNOWN]])
  })

  it('warms the worker up, prepares a run and fails both alike', async () => {
    await both({ installed: [CLAUDE] }, [['warm', UNKNOWN], ['warm', SHARVARD_M], ['hold', 'prepare'], ['warm', CLAUDE], ['warm', CLAUDE], ['open', 'prepare'], ['open', 'prepare'], ['flow', 'prepare'], ['fail', 'prepare', 'init-failed'], ['warm', CLAUDE], ['warm', CLAUDE]])
    const log = await both({ installed: [CLAUDE, SHARVARD_M] }, [['hold', 'prepare'], ['speak', 'Una frase.', CLAUDE], ['open', 'prepare'], ['feed'], ['advance', 1], ['stop'], ['fail', 'prepare', 'init-failed'], ['flow', 'prepare'], ['release'],
      ['speak', 'Otra frase.', SHARVARD_M], ['speak', 'Y otra.', CLAUDE], ['feed'], ['advance', 1], ['remove', CLAUDE]])
    expect(has(log, 'tts', [['type', 'start'], ['id', 'Una frase.']])).toBe(true)
    expect(has(log, 'tts', [['type', 'error'], ['id', 'Otra frase.'], ['reason', 'init-failed']])).toBe(true)
  })

  it('agrees on generated scripts', async () => {
    let seed = 7141
    const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32
    const pick = list => list[Math.floor(random() * list.length)]
    const ids = [CLAUDE, CLAUDE, SHARVARD_M, SHARVARD_F, UNKNOWN], kinds = ['download', 'list', 'remove', 'prepare'], codes = ['offline', 'http', 'storage', 'aborted', 'init-failed']
    for (let round = 0; round < 250; round++) {
      const script = []
      for (let step = 0, steps = 5 + Math.floor(random() * 14); step < steps; step++) {
        const roll = random()
        if (roll < .14) script.push(['refresh'])
        else if (roll < .32) script.push(['install', pick(ids), pick(['none', 'options', 'options', 'aborted', 'null'])])
        else if (roll < .40) script.push(['cancel', pick(ids)])
        else if (roll < .48) script.push(['remove', pick(ids)])
        else if (roll < .58) script.push(['warm', pick(ids)])
        else if (roll < .66) script.push(['speak', `Frase ${step}.`, pick(ids)])
        else if (roll < .70) script.push([pick(['stop', 'release', 'feed'])])
        else if (roll < .76) script.push(['progress', Math.floor(random() * 100), pick([100, 100, 0])])
        else if (roll < .84) script.push(['hold', pick(kinds)])
        else if (roll < .93) script.push(['open', pick(kinds)])
        else if (roll < .97) script.push(['fail', pick(kinds), pick(codes)])
        else script.push(['advance', .5])
      }
      await both({ installed: random() < .5 ? [pick(ids.slice(0, 4))] : [], legacy: random() < .7 }, script)
    }
  }, 240000)
  // NEURAL_FLOWS_BENCH=1 npx vitest run tests/unit/neural-engine-flows-wasm.test.js -t "measures"
  it.skipIf(!process.env.NEURAL_FLOWS_BENCH)('measures the flows against their JavaScript', async () => {
    const median = values => values.slice().sort((a, b) => a - b)[values.length >> 1]
    const make = Engine => {
      const env = new EventTarget(), ctx = fakeAudioContext(), listed = new Set([model(CLAUDE)])
      Object.assign(env, { Worker: function () {}, WebAssembly: {}, AudioContext: function () {}, caches: {} })
      const client = { alive: true, prepare: async () => {}, synth() {}, dispose() {} }
      const engine = new Engine({ store: { list: async () => listed, download: async () => ({ bytes: 1 }), remove: async () => {} }, createClient: () => client, audio: { context: () => ctx, unlock: () => ctx }, env,
        setTimer: () => 0, clearTimer: () => {} })
      engine._installed = new Set([CLAUDE])
      return engine
    }
    const engines = { reference: make(ReferenceNeuralEngine), live: make(NeuralEngine) }
    const flows = { refresh: engine => engine.refresh(), warmUp: engine => engine.warmUp(CLAUDE), 'install + remove': async engine => { await engine.install(SHARVARD_M); await engine.remove(SHARVARD_M) } }
    for (const [name, flow] of Object.entries(flows)) {
      const times = { reference: [], live: [] }, calls = 2000
      for (let round = 0; round < 17; round++) for (const side of ['reference', 'live']) {
        const start = process.hrtime.bigint()
        for (let i = 0; i < calls; i++) await flow(engines[side])
        if (round > 1) times[side].push(Number(process.hrtime.bigint() - start) / 1e3 / calls)
      }
      console.log(`${name}: JavaScript ${median(times.reference).toFixed(2)} us, Rust ${median(times.live).toFixed(2)} us (medians of 15 interleaved rounds of ${calls} calls)`)
    }
  }, 600000)
})
