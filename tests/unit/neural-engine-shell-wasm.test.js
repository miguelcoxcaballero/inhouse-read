// @vitest-environment node
// The shell of the neural engine built by rust-ui (neural_engine_shell.rs) against the frozen JavaScript class: what the
// constructor leaves on the engine for every kind of dependency, in which order it reads them, what its defaults do, and
// the functions it hands to the browser (timers, synthesis handlers, the reader's event, the audio context's listener,
// the abort of a download, the player's notifications). A function is "the same" when calling it reads and writes the
// same properties of the same objects in the same order and answers the same: the objects are traced.
import { afterEach, expect, it, vi } from 'vitest'
import './helpers/rust-ui-ready.js'
import { readerUI } from '../../src/js/readers/rust-ui-required.js'
import { NeuralEngine as Frozen, LIMITS as FROZEN_LIMITS, FragmentCache as FrozenCache } from './helpers/reference-neural-engine-shell.js'
import { NeuralEngine as Live, LIMITS, FragmentCache } from '../../src/js/readers/neural-voice/engine.js'
import { audioContext, resetAudio } from '../../src/js/readers/neural-voice/audio.js'
import { neuralVoices } from '../../src/js/readers/neural-voice/catalog.js'
import { fakeAudioContext } from './neural-fakes.js'

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); resetAudio(); delete globalThis.InhouseInference })

const brief = value => value === null ? 'null' : typeof value === 'function' ? 'function' : typeof value !== 'object' ? `${typeof value}:${String(value)}`
  : value instanceof Map ? `Map(${value.size})` : value instanceof Set ? `Set(${value.size})` : Array.isArray(value) ? `Array(${value.length})` : value.constructor?.name || 'object'
const plain = value => value && typeof value === 'object' && !(value instanceof Map) && !(value instanceof Set) && !(value instanceof EventTarget) && !ArrayBuffer.isView(value)
function traced(target, name, log) {
  return new Proxy(target, {
    get(inner, key) {
      const value = Reflect.get(inner, key)
      if (typeof key !== 'string') return value
      log.push(`get ${name}.${key}`)
      return plain(value) ? traced(value, `${name}.${key}`, log) : value
    },
    set(inner, key, value) { log.push(`set ${name}.${String(key)}=${brief(value)}`); return Reflect.set(inner, key, value) }
  })
}
const attempt = (log, label, work) => { try { log.push(`${label} -> ${brief(work())}`) } catch (error) { log.push(`${label} threw ${error?.constructor?.name}:${error?.message}`) } }
// `epoch` is a counter shared by every native player of the realm.
const shape = engine => Object.keys(engine).map(key => [key, key === 'epoch' ? 'counter' : brief(engine[key])])
const voice = { id:'piper:test', piperId:'test', lang:'es-ES', speaker:0 }
const entry = () => ({ unit:1, id:'fragment', text:'Hola mundo', marks:[0, 5], state:'synth', chunks:[], started:false, ended:false, total:0, counts:null, deferred:false })
const run = () => ({ voice, rate:1, entries:[entry()], prepared:'ready', job:null, pumpTimer:null, feedTimer:null, holdTimer:null, token:1, gate:false, preview:false })

it('keeps the limits and the cache of the frozen module', () => {
  expect(LIMITS).toEqual(FROZEN_LIMITS)
  expect(Object.keys(LIMITS)).toEqual(Object.keys(FROZEN_LIMITS))
  expect(Object.keys(new FragmentCache(3, 9))).toEqual(Object.keys(new FrozenCache(3, 9)))
})

it('builds the same engine for every kind of dependency, reading them in the same order', () => {
  const setTimer = () => 7, clearTimer = () => {}, createClient = () => ({}), store = { list:async () => new Set() }
  const cases = [
    () => undefined, () => ({}), () => ({ voices:[voice] }), () => ({ store }), () => ({ createClient }), () => ({ audio:{ context:() => null, unlock:() => null } }),
    () => ({ env:new EventTarget() }), () => ({ env:{ InhousePcm:{ getProtocol:() => 1 } } }), () => ({ env:{ InhousePcm:{ getProtocol:() => 1 } }, audio:{ context:() => null, unlock:() => null } }),
    () => ({ setTimer, clearTimer }), () => ({ limits:{ maxAhead:2, extra:1 } }), () => ({ limits:null }), () => ({ limits:5 }), () => ({ voices:null, store:0, createClient:'', audio:false }),
    () => ({ voices:[voice], store, createClient, audio:{ context:() => null, unlock:() => null }, env:{}, setTimer, clearTimer, limits:{ lruEntries:2, lruSamples:10 } })
  ]
  for (const [index, make] of cases.entries()) {
    const logs = [[], []], built = []
    for (const [which, Class] of [Frozen, Live].entries()) {
      const deps = make()
      try {
        const engine = new Class(deps && traced(deps, 'deps', logs[which]))
        built.push(engine)
        logs[which].push(JSON.stringify(shape(engine)), JSON.stringify(engine.limits), JSON.stringify(engine.stats), JSON.stringify(shape(engine.cache)), JSON.stringify(shape(engine.player)),
          JSON.stringify(Object.keys(engine.audio)), engine.models instanceof Map ? [...engine.models.keys()].join() : 'no models', engine.store.constructor.name,
          String(engine.voices === (deps?.voices === undefined ? neuralVoices : deps.voices)), String(deps?.env === undefined ? engine.env === globalThis : true),
          String(engine instanceof EventTarget), engine.status, String(engine.nativePlayer), brief(engine.installed), brief(engine.downloads))
      } catch (error) { logs[which].push(`threw ${error.constructor.name}`) }
    }
    expect(logs[1], `case ${index}`).toEqual(logs[0])
  }
  expect(() => new Live(null)).toThrow(TypeError)
  expect(() => new Frozen(null)).toThrow(TypeError)
})

it('gives the same defaults: timers of the page, the shared audio context, the worker client of its own store', () => {
  for (const Class of [Frozen, Live]) {
    vi.useFakeTimers()
    const begun = [], env = { InhousePcm:{ getProtocol:() => 1, begin:(...args) => begun.push(args.length, args[1]), stop() {}, pause() {} } }
    const engine = new Class({ env })
    const fired = vi.fn()
    const id = engine.setTimer(fired, 50)
    vi.advanceTimersByTime(49); expect(fired).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1); expect(fired).toHaveBeenCalledTimes(1); expect(fired.mock.calls[0]).toEqual([])
    const cancelled = vi.fn()
    expect(engine.clearTimer(engine.setTimer(cancelled, 10))).toBe(undefined)
    vi.advanceTimersByTime(20); expect(cancelled).not.toHaveBeenCalled()
    expect(id).toBeTruthy()
    expect(engine.audio.context).toBe(audioContext)
    const context = engine.audio.unlock('ignored')
    expect(begun).toEqual([2, 'Audiolibro'])
    expect(context).toMatchObject({ native:true, state:'running' })
    expect(engine.player.constructor.name).toBe('NativePcmPlayer')
    globalThis.InhouseInference = { getProtocol:() => 1 }
    const client = engine.createClient('ignored')
    expect(client.constructor.name).toBe('NativeSynthClient')
    engine.store = { marker:true }
    expect(engine.createClient().store).toBe(engine.store)
    delete globalThis.InhouseInference
    vi.useRealTimers(); resetAudio()
    // The web player asks the engine's audio for the context each time, and shares the injected timers.
    const ctx = fakeAudioContext(), setTimer = vi.fn(() => 3), clearTimer = vi.fn()
    const web = new Class({ audio:{ context:() => ctx, unlock:() => ctx }, env:new EventTarget(), setTimer, clearTimer })
    expect(web.player.constructor.name).toBe('GaplessPlayer')
    expect(web.player.getContext('ignored')).toBe(ctx)
    const other = fakeAudioContext(); web.audio = { context:() => other }
    expect(web.player.getContext()).toBe(other)
    expect(web.player.setTimer).toBe(setTimer); expect(web.player.clearTimer).toBe(clearTimer)
  }
})

it('hands the browser functions that do what the arrows of the frozen engine did', async () => {
  const ui = readerUI()
  vi.spyOn(performance, 'now').mockReturnValue(1000)
  const logs = [[], []]
  for (const [which, Class] of [Frozen, Live].entries()) {
    const log = logs[which]
    let tick = 0
    const timers = []
    const env = new EventTarget()
    env.addEventListener('inhouse-tts', event => log.push(`event ${event.constructor.name} ${JSON.stringify(event.detail)} at ${tick}`))
    const ctx = fakeAudioContext()
    const engine = new Class({ voices:[voice], store:{ list:async () => new Set() }, createClient:() => ({ synth:() => ({ cancel() {} }), prepare:async () => ({}), dispose() {} }),
      audio:{ context:() => ctx, unlock:() => ctx }, env, setTimer:(task, ms) => { timers.push(task); log.push(`setTimer ${typeof task} ${ms}`); return 100 + timers.length },
      clearTimer:id => log.push(`clearTimer ${id}`) })
    const arm = which ? (r, kind, ms) => ui.neural_arm(engine, r, kind, ms) : (r, kind, ms) => engine._arm(r, kind, ms)
    const handlers = which ? (r, e) => ui.neural_handlers(engine, r, e) : (r, e) => engine._handlers(r, e)
    const emit = which ? detail => ui.neural_emit(engine, detail) : detail => engine._emit(detail)
    const listen = which ? target => ui.neural_listen(engine, target) : target => engine._listen(target)
    const aborter = which ? abort => ui.neural_aborter(abort) : abort => engine._aborter(abort)

    // Timers: the id of the page's timer comes back, and firing tells the engine which timer of which run it was.
    for (const kind of ['pump', 'feed', 'hold', 'idle']) {
      const current = traced(run(), 'run', log)
      engine.run = current
      current[`${kind}Timer`] = 100 + timers.length + 1
      attempt(log, `arm ${kind}`, () => arm(current, kind, 25))
      attempt(log, `fire ${kind}`, () => timers.at(-1)('ignored'))
      attempt(log, `fire ${kind} again`, () => timers.at(-1)())
      engine.run = null
    }
    // Synthesis handlers.
    {
      const current = traced(run(), 'run', log), item = traced(entry(), 'entry', log)
      engine.run = current
      const made = handlers(current, item)
      log.push(Object.keys(made).join(), Object.values(made).map(value => typeof value).join())
      attempt(log, 'onPlan', () => made.onPlan([3, 4], 'ignored'))
      attempt(log, 'onChunk', () => made.onChunk({ index:0, last:true, pcm:new Float32Array(8), sampleRate:22050, ms:5 }, 'ignored'))
      attempt(log, 'onEnd', () => made.onEnd('ignored'))
      attempt(log, 'onError', () => made.onError(Object.assign(new Error('synth'), { code:'init-failed' }), 'ignored'))
      engine.run = null
    }
    // The player's notifications.
    for (const name of ['onStart', 'onEnd', 'onMark']) {
      const current = traced(run(), 'run', log)
      engine.run = current
      attempt(log, name, () => engine.player[name](1, 5, 'ignored'))
      attempt(log, `${name} of an unknown unit`, () => engine.player[name](9, 0))
      engine.run = null
    }
    // The reader's event: one microtask later, on the environment, with the very detail object.
    const detail = { type:'start', id:'fragment' }
    const seen = []
    env.addEventListener('inhouse-tts', event => seen.push(event.detail === detail))
    attempt(log, 'emit', () => emit(detail))
    log.push(`before the microtask ${seen.length}`)
    for (let step = 0; step < 4; step++) { await Promise.resolve(); tick++ }
    log.push(`after ${seen.join()}`)
    engine.env = {}
    attempt(log, 'emit without dispatchEvent', () => emit(detail))
    for (let step = 0; step < 4; step++) { await Promise.resolve(); tick++ }
    engine.env = env
    // The audio context's listener.
    {
      const added = []
      const target = traced({ state:'suspended', addEventListener:(...args) => { added.push(args) } }, 'ctx', log)
      attempt(log, 'listen', () => listen(target))
      log.push(`listener ${added[0].length} ${added[0][0]} ${typeof added[0][1]}`)
      attempt(log, 'statechange', () => added[0][1]({ type:'statechange' }))
      attempt(log, 'listen without addEventListener', () => listen(traced({ state:'running' }, 'bare', log)))
    }
    // The abort of a download: never with the signal's event as its reason.
    {
      const abort = { abort(...args) { log.push(`abort ${args.length} ${this === abort}`); return 'aborted' } }
      const made = aborter(abort)
      attempt(log, 'aborter', () => made({ type:'abort' }))
    }
  }
  expect(logs[1]).toEqual(logs[0])
  expect(logs[0].length).toBeGreaterThan(120)
  for (const needle of ['fire pump', 'fire idle', 'onChunk', 'event CustomEvent', 'abort 0 true', 'statechange', 'set entry.counts']) expect(logs[0].some(line => line.includes(needle)), needle).toBe(true)
})
