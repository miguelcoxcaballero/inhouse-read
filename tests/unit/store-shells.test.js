// What the constructors of the voice stores and of the Web Audio player build, the default pause between two attempts of
// a download and the install job of the Supertonic pack are rust-ui (store_shells.rs, neural_player.rs). This
// differential runs the frozen JavaScript and the Rust over the same dependencies, signals, timers and caches, and
// compares the fields in their order, every default, every listener and timer and the step of every settlement.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { rustUI as ui } from './helpers/rust-ui-ready.js'
import { referenceDefaultSleep, referenceGaplessConstruct, referenceSupertonicConstruct, referenceSupertonicInstall, referenceVoiceStoreConstruct } from './helpers/reference-store-shells.js'

const plain = events => JSON.parse(JSON.stringify(events, (key, value) => value === undefined ? '<undefined>' : typeof value === 'function' ? '<function>' : value))
const tick = async (events, steps) => { for (let n = 0; n < steps; n++) { await Promise.resolve(); events.push(['tick', n]) } }
const both = async scene => {
  const outcomes = {}
  for (const engine of ['JavaScript', 'Rust']) { const events = []; await scene(engine, events); outcomes[engine] = plain(events) }
  expect(outcomes.Rust).toEqual(outcomes.JavaScript)
  expect(outcomes.Rust.length).toBeGreaterThan(0)
  return outcomes.Rust
}
const attempt = (events, label, action) => { try { events.push([label, action()]) } catch (error) { events.push([label, 'threw', error.constructor.name]) } }
/** Replaces a property of globalThis (or of navigator) for one scene. */
const restores = []
const replace = (owner, name, descriptor) => { const old = Object.getOwnPropertyDescriptor(owner, name); Object.defineProperty(owner, name, { configurable:true, ...descriptor }); restores.push(() => old ? Object.defineProperty(owner, name, old) : delete owner[name]) }
afterEach(() => { while (restores.length) restores.pop()(); vi.useRealTimers() })
const given = names => events => { const deps = {}; for (const name of names) Object.defineProperty(deps, name, { enumerable:true, get() { events.push(['read', name]); return `${name}!` } }); return deps }

describe('constructor of the Piper voice store', () => {
  const neuralVoiceBase = () => 'https://voices.example/'
  // As store.js writes it: the bundler's base URL is the page's.
  const dictionaryBase = () => new URL(`${import.meta.env?.BASE_URL || '/'}neural-voice/phon/`, globalThis.location?.href || 'http://localhost/').href
  const construct = (engine, store, deps) => engine === 'Rust' ? ui.voice_store_construct(store, deps, { base:() => neuralVoiceBase(), dictionaryBase })
    : referenceVoiceStoreConstruct.call(store, { neuralVoiceBase, defaultSleep:referenceDefaultSleep(ui) }, deps)
  const names = ['caches', 'fetch', 'base', 'dictionaryBase', 'storage', 'sleep', 'maxRetries', 'online', 'stallMs']
  const cases = {
    'no dependencies': () => undefined,
    'an empty object': () => ({}),
    'every dependency, read once and in order': given([...names].reverse()),
    'null, zero and false are kept': () => ({ caches:null, fetch:null, base:null, dictionaryBase:0, storage:null, sleep:false, maxRetries:0, online:null, stallMs:0, extra:1 }),
    'null': () => null,
    'a number': () => 7,
  }
  it.each(Object.keys(cases))('%s', async name => {
    await both((engine, events) => {
      const marks = { caches:{ id:'caches' }, storage:{ id:'storage' } }
      replace(globalThis, 'caches', { get() { events.push(['globalThis.caches']); return marks.caches } })
      replace(globalThis, 'fetch', { get() { events.push(['globalThis.fetch']); return function fetch() { return this === globalThis } } })
      replace(globalThis.navigator, 'storage', { get() { events.push(['navigator.storage']); return marks.storage } })
      const store = {}, deps = cases[name](events)
      try { construct(engine, store, deps) } catch (error) { events.push(['threw', error.constructor.name]); return }
      events.push(['keys', Object.keys(store)])
      const typed = deps && typeof deps === 'object' && 'caches' in deps
      events.push(['values', typed ? store.caches : store.caches === marks.caches, typed ? store.storage : store.storage === marks.storage, typed ? store.fetchFn : [typeof store.fetchFn, store.fetchFn()],
        store.maxRetries, store.stallMs, ...['baseFn', 'dictionaryBase', 'sleep', 'online'].map(key => typeof store[key] === 'function' ? typeof store[key] : store[key])])
      if (!typed) {
        events.push(['defaults', store.baseFn(), store.dictionaryBase(), store.online()])
        for (const value of [false, true, undefined, null, 0]) { replace(globalThis.navigator, 'onLine', { get:() => value }); events.push(['online', value, store.online()]) }
      }
    })
  })
  it('a page without fetch or navigator gets no fetch, no storage and is online', async () => {
    await both((engine, events) => {
      replace(globalThis, 'fetch', { value:undefined }); replace(globalThis, 'navigator', { value:undefined })
      const store = {}; construct(engine, store, undefined)
      events.push(['values', store.fetchFn, store.storage, store.online()])
    })
  })
})

describe('the default pause between two attempts of a download', () => {
  const sleepOf = engine => { if (engine !== 'Rust') return referenceDefaultSleep(ui); const store = {}; ui.voice_store_construct(store, {}, {}); return store.sleep }
  const signalOf = (events, aborted = false, broken = null) => {
    const signal = { aborted, listeners:[],
      addEventListener(type, listener, options) { events.push(['add', type, typeof listener, options]); if (broken === 'add') throw new Error('no listeners'); signal.listeners.push(listener) },
      removeEventListener(type, listener, ...rest) { events.push(['remove', type, signal.listeners.indexOf(listener), rest.length]); if (broken === 'remove') throw new Error('cannot remove') } }
    return signal
  }
  const watch = (events, promise) => { events.push(['promise', promise instanceof Promise]); promise.then(value => events.push(['resolved', value]), error => events.push(['rejected', error.message, error.code, error instanceof Error])) }
  const scripts = {
    'resolves when the time is over and removes its listener': async (events, sleep) => {
      const signal = signalOf(events); watch(events, sleep(700, signal)); events.push(['timers', vi.getTimerCount()])
      await tick(events, 2); vi.advanceTimersByTime(699); await tick(events, 2); vi.advanceTimersByTime(1); await tick(events, 3); events.push(['timers', vi.getTimerCount()])
    },
    'rejects as soon as the download is given up, and clears its timer': async (events, sleep) => {
      const signal = signalOf(events); watch(events, sleep(60000, signal)); await tick(events, 2)
      attempt(events, 'abort', () => signal.listeners[0]({ type:'abort' })); events.push(['timers', vi.getTimerCount()]); await tick(events, 3)
      vi.advanceTimersByTime(60000); await tick(events, 2)
    },
    'rejects at once for a download already given up, without a listener or a timer': async (events, sleep) => {
      const signal = signalOf(events, true); watch(events, sleep(700, signal)); events.push(['timers', vi.getTimerCount()]); await tick(events, 3)
    },
    'waits without a signal': async (events, sleep) => {
      watch(events, sleep(5)); watch(events, sleep('5', null)); watch(events, sleep()); events.push(['timers', vi.getTimerCount()])
      await tick(events, 2); vi.advanceTimersByTime(0); await tick(events, 2); vi.advanceTimersByTime(5); await tick(events, 3); events.push(['timers', vi.getTimerCount()])
    },
    'a signal that cannot be listened to fails the pause and leaves its timer': async (events, sleep) => {
      const signal = signalOf(events, false, 'add'); watch(events, sleep(700, signal)); events.push(['timers', vi.getTimerCount()]); await tick(events, 3)
      vi.advanceTimersByTime(700); await tick(events, 3)
    },
    'a listener that cannot be removed': async (events, sleep) => {
      const signal = signalOf(events, false, 'remove'); watch(events, sleep(700, signal)); await tick(events, 1)
      attempt(events, 'abort', () => signal.listeners[0]()); await tick(events, 3); events.push(['timers', vi.getTimerCount()])
      watch(events, sleep(5, signalOf(events, false, 'remove'))); attempt(events, 'time', () => vi.advanceTimersByTime(5)); await tick(events, 3)
    },
  }
  it.each(Object.keys(scripts))('%s', async script => {
    const seen = await both(async (engine, events) => { vi.useFakeTimers(); await scripts[script](events, sleepOf(engine)); vi.useRealTimers() })
    expect(seen.some(event => event[0] === 'resolved' || event[0] === 'rejected')).toBe(!script.startsWith('a listener that cannot'))
  })
})

describe('the Supertonic pack store', () => {
  const SUPERTONIC_ASSETS = [{ path:'onnx/a.onnx', bytes:3, sha256:'aa' }, { path:'voice_styles/F1.json', bytes:2, sha256:'bb' }], SUPERTONIC_LEGACY_ASSETS = [{ path:'onnx/a.onnx', bytes:3, sha256:'aa' }]
  const supertonicBase = () => 'https://pack.example/v1/', supertonicAssetUrl = (base, path) => base + path, SUPERTONIC_REVISION = 'r1', noop = () => {}
  const kit = { base:supertonicBase, assets:SUPERTONIC_ASSETS, legacyAssets:SUPERTONIC_LEGACY_ASSETS, revision:SUPERTONIC_REVISION, url:supertonicAssetUrl, noop }
  const construct = (engine, store, deps) => engine === 'Rust' ? ui.supertonic_store_construct(store, deps, kit) : referenceSupertonicConstruct.call(store, ui, { SUPERTONIC_ASSETS, SUPERTONIC_LEGACY_ASSETS, supertonicBase }, deps)
  const install = (engine, store, options) => engine === 'Rust' ? ui.supertonic_store_install(store, options, kit) : referenceSupertonicInstall.call(store, ui, { SUPERTONIC_REVISION, supertonicAssetUrl }, options)
  const other = [{ path:'onnx/b.onnx', bytes:1, sha256:'cc' }]
  const cases = {
    'no dependencies': () => undefined,
    'an empty object': () => ({}),
    'another pack has no legacy assets': () => ({ assets:other, base:'https://mirror.example/' }),
    'the legacy assets that were given': () => ({ assets:other, legacyAssets:SUPERTONIC_LEGACY_ASSETS, stallMs:5 }),
    'the catalogue given by name keeps its legacy assets': () => ({ assets:SUPERTONIC_ASSETS }),
    'services, read once and in order': given(['stallMs', 'storage', 'crypto', 'fetch', 'caches']),
    'null and zero are kept': () => ({ caches:null, fetch:null, storage:null, crypto:null, stallMs:0, legacyAssets:null }),
    'a base that is not text': () => ({ base:7 }),
    'assets that cannot be listed': () => ({ assets:null }),
    'null': () => null,
  }
  it.each(Object.keys(cases))('constructor: %s', async name => {
    await both((engine, events) => {
      const marks = { caches:{ id:'caches' }, crypto:{ id:'crypto' } }
      replace(globalThis, 'caches', { get() { events.push(['globalThis.caches']); return marks.caches } })
      replace(globalThis, 'crypto', { get() { events.push(['globalThis.crypto']); return marks.crypto } })
      const store = {}, deps = cases[name](events)
      try { construct(engine, store, deps) } catch (error) { events.push(['threw', error.constructor.name]); return }
      events.push(['keys', Object.keys(store)])
      events.push(['values', store.caches === marks.caches || store.caches, store.crypto === marks.crypto || store.crypto, typeof store.fetchFn, store.storage === globalThis.navigator.storage || store.storage,
        store.base, store.assets === SUPERTONIC_ASSETS || store.assets, store.legacyAssets === SUPERTONIC_LEGACY_ASSETS || store.legacyAssets, store.stallMs, store.marker, store.manifest, store.job, store.generation, store.controller])
    })
  })

  /** A store whose cache opens when the script says. */
  function world(engine, events) {
    const opens = [], store = {}
    construct(engine, store, { caches:{ open:name => { events.push(['open', name]); return new Promise((resolve, reject) => opens.push({ resolve, reject })) } }, fetch:() => { events.push(['fetch']) }, storage:null, crypto:null })
    const signalOf = (aborted = false) => { const signal = { aborted, listeners:[], addEventListener(type, listener, options) { events.push(['add', type, options]); signal.listeners.push(listener) },
      removeEventListener(type, listener) { events.push(['remove', type, signal.listeners.indexOf(listener)]) } }; return signal }
    const watch = (label, promise) => { promise.then(value => events.push([label, 'resolved', value]), error => events.push([label, 'rejected', error.message, error.code])); return promise }
    const state = () => events.push(['state', store.job === null ? null : store.job instanceof Promise, store.controller === null ? null : [store.controller instanceof AbortController, store.controller.signal.aborted], store.generation])
    return { store, opens, signalOf, watch, state, install:options => install(engine, store, options) }
  }
  const scripts = {
    'one job at a time: a second call gets the same promise, and the job is forgotten when it ends': async (events, { opens, signalOf, watch, state, install }) => {
      const signal = signalOf(), first = watch('first', install({ signal, onProgress() {} })), second = install({ signal:signalOf() }); events.push(['same', first === second]); state()
      await tick(events, 3); events.push(['opens', opens.length]); opens[0].reject(new Error('no cache')); await tick(events, 6); state()
      watch('again', install()); state(); await tick(events, 3); events.push(['opens', opens.length]); opens[1]?.reject(new Error('still none')); await tick(events, 6); state()
    },
    'a download already given up aborts its controller before the job starts': async (events, { opens, signalOf, watch, state, install }) => {
      watch('job', install({ signal:signalOf(true) })); state(); await tick(events, 6); state(); events.push(['opens', opens.length])
    },
    'giving the download up aborts the job\'s controller, whatever the listener is called with': async (events, { store, opens, signalOf, watch, state, install }) => {
      const signal = signalOf(); watch('job', install({ signal })); await tick(events, 2)
      const controller = store.controller; events.push(['abort', signal.listeners[0]({ type:'abort' }), controller.signal.aborted, controller.signal.reason?.name]); state()
      opens[0]?.resolve({ match:async () => undefined, delete:async () => false }); await tick(events, 8); state()
    },
    'a job replaced meanwhile leaves the newer one in place': async (events, { store, opens, watch, state, install }) => {
      watch('job', install()); await tick(events, 2); const newer = store.job = Promise.resolve('newer'), controller = store.controller = { tag:'newer' }
      opens[0].reject(new Error('no cache')); await tick(events, 6); events.push(['kept', store.job === newer, store.controller === controller])
    },
    'options that cannot be read': async (events, { state, install }) => {
      attempt(events, 'null', () => install(null)); state(); await tick(events, 1)
    },
  }
  it.each(Object.keys(scripts))('install: %s', async script => { await both((engine, events) => scripts[script](events, world(engine, events))) })
})

describe('constructor of the Web Audio player', () => {
  const kit = { noop() {}, setTimer:(fn, ms) => setTimeout(fn, ms), clearTimer:id => clearTimeout(id) }
  const cases = {
    'only the context': () => ({ context() {} }),
    'everything': () => ({ context() {}, onStart() {}, onEnd() {}, onMark() {}, setTimer() {}, clearTimer() {}, extra:1 }),
    'null is kept, undefined takes the default': () => ({ context:null, onStart:null, onEnd:undefined, onMark:0, setTimer:null, clearTimer:undefined }),
    'read once and in order': given(['clearTimer', 'onMark', 'context', 'setTimer', 'onEnd', 'onStart']),
    'an empty object': () => ({}),
    'undefined': () => undefined,
    'null': () => null,
  }
  it.each(Object.keys(cases))('%s', async name => {
    await both(async (engine, events) => {
      vi.useFakeTimers()
      const player = {}, options = cases[name](events)
      try { if (engine === 'Rust') ui.gapless_construct(player, options, kit); else referenceGaplessConstruct.call(player, options) } catch (error) { events.push(['threw', error.constructor.name]); return }
      events.push(['keys', Object.keys(player)])
      events.push(['values', ...['getContext', 'onStart', 'onEnd', 'onMark', 'setTimer', 'clearTimer'].map(key => options[key === 'getContext' ? 'context' : key] === undefined ? typeof player[key] : player[key] === options[key === 'getContext' ? 'context' : key] || player[key]),
        player.units instanceof Map, player.units.size, player.nextTime, player.scheduled])
      if (options.onEnd === undefined && options.setTimer === undefined) {
        events.push(['notifications', player.onStart(1), player.onEnd(1), player.onMark(1, 2)])
        const handle = player.setTimer(() => events.push(['fired']), 30); events.push(['timers', vi.getTimerCount()]); vi.advanceTimersByTime(30)
        player.clearTimer(player.setTimer(() => events.push(['never']), 30)); events.push(['timers', vi.getTimerCount(), typeof handle]); vi.advanceTimersByTime(30)
      }
      vi.useRealTimers()
    })
  })
})
