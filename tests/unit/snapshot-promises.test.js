// The waits of a page snapshot (a deadline around a decode, the read of a local Blob, its data URL, an image load) are
// rust-ui snapshot_promises.rs. This differential runs the frozen JavaScript helpers and the Rust ones over the same
// timers, clock, FileReader, fetch and image, and compares every call and the microtask step of every settlement.
// SNAPSHOT_PROMISES_BENCH=1 npx vitest run tests/unit/snapshot-promises.test.js also measures a deadline around a decode.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { rustUI as ui } from './helpers/rust-ui-ready.js'
import * as reference from './helpers/reference-snapshot-promises.js'

const rust = { beforeDeadline:(promise, deadline) => ui.snapshot_promise(0, promise, deadline), localBlob:href => ui.snapshot_promise(1, href), blobDataURL:blob => ui.snapshot_promise(2, blob),
  loadImage:(image, url) => ui.snapshot_promise(3, image, url) }
const plain = events => JSON.parse(JSON.stringify(events, (key, value) => value === undefined ? '<undefined>' : typeof value === 'function' ? '<function>' : Number.isNaN(value) ? '<NaN>' : value))
const tick = async (events, steps) => { for (let n = 0; n < steps; n++) { await Promise.resolve(); events.push(['tick', n]) } }
// The engine words a missing method with the expression that named it (`response.blob`); only that text is levelled.
const watch = (events, label, make) => {
  let promise
  try { promise = make() } catch (error) { events.push([label, 'threw', error.message]); return }
  events.push([label, 'promise', promise instanceof Promise])
  promise.then(value => events.push([label, 'resolved', value]), error => events.push([label, 'rejected', error instanceof Error ? `${error.constructor.name}: ${error.message.replace(/^.* is not a function$/, 'not a function')}` : error]))
}
const both = async scene => {
  const outcomes = {}
  for (const engine of ['JavaScript', 'Rust']) { const events = []; await scene(engine === 'Rust' ? rust : reference, events); outcomes[engine] = plain(events) }
  expect(outcomes.Rust).toEqual(outcomes.JavaScript)
  expect(outcomes.Rust.length).toBeGreaterThan(2)
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('a deadline around a wait', () => {
  const clocked = events => {
    vi.useFakeTimers({ toFake:['setTimeout', 'clearTimeout', 'performance'] })
    const set = globalThis.setTimeout, clear = globalThis.clearTimeout
    vi.stubGlobal('setTimeout', (callback, delay, ...rest) => { events.push(['setTimeout', typeof callback, delay, rest.length]); return set(callback, delay) })
    vi.stubGlobal('clearTimeout', (...ids) => { events.push(['clearTimeout', ids.length]); return clear(...ids) })
  }
  const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
  const scripts = {
    'answers with the value when it arrives in time and clears its timer': async (wait, events) => {
      const decode = deferred(); watch(events, 'wait', () => wait(decode.promise, performance.now() + 1500)); await tick(events, 2)
      vi.advanceTimersByTime(1499); decode.resolve('decoded'); await tick(events, 4); events.push(['timers', vi.getTimerCount()]); vi.advanceTimersByTime(10); await tick(events, 2)
    },
    'fails with the error of the wait when it fails in time': async (wait, events) => {
      const decode = deferred(); watch(events, 'wait', () => wait(decode.promise, performance.now() + 1500)); await tick(events, 2)
      decode.reject(new TypeError('broken image')); await tick(events, 4); events.push(['timers', vi.getTimerCount()])
    },
    'gives up when the clock reaches the deadline, and ignores what arrives later': async (wait, events) => {
      const decode = deferred(); watch(events, 'wait', () => wait(decode.promise, performance.now() + 1500)); await tick(events, 2)
      vi.advanceTimersByTime(1499); await tick(events, 2); vi.advanceTimersByTime(1); await tick(events, 3); decode.resolve('late'); await tick(events, 4); events.push(['timers', vi.getTimerCount()])
    },
    'waits for what is not a promise, a thenable and nothing at all': async (wait, events) => {
      watch(events, 'value', () => wait('ready', performance.now() + 100)); watch(events, 'nothing', () => wait(undefined, performance.now() + 100))
      watch(events, 'thenable', () => wait({ then(resolve) { events.push(['then called']); resolve('thenable') } }, performance.now() + 100))
      await tick(events, 5); events.push(['timers', vi.getTimerCount()])
    },
    'a deadline already past, or that is not a time, leaves no room': async (wait, events) => {
      const decode = deferred()
      for (const deadline of [performance.now() - 50, undefined, NaN, null, '7', Infinity]) watch(events, String(deadline), () => wait(decode.promise, deadline))
      await tick(events, 2); vi.advanceTimersByTime(0); await tick(events, 3); vi.advanceTimersByTime(7); await tick(events, 3); events.push(['timers', vi.getTimerCount()])
    },
    'a thenable that throws fails the wait': async (wait, events) => {
      watch(events, 'wait', () => wait({ then() { throw new Error('bad thenable') } }, performance.now() + 100)); await tick(events, 4); events.push(['timers', vi.getTimerCount()])
    },
    'a page that cannot set a timer fails the wait': async (wait, events) => {
      vi.stubGlobal('setTimeout', () => { throw new Error('no timers') })
      watch(events, 'wait', () => wait(Promise.resolve('ready'), performance.now() + 100)); await tick(events, 4)
    },
  }
  it.each(Object.keys(scripts))('%s', async script => { await both(async (helpers, events) => { clocked(events); await scripts[script](helpers.beforeDeadline, events); vi.unstubAllGlobals(); vi.useRealTimers() }) })
})

describe('the read of a local Blob, its data URL and an image load', () => {
  it('reads a Blob through fetch, called as a plain function', async () => {
    await both(async (helpers, events) => {
      const answers = [Promise.resolve({ blob() { events.push(['blob()']); return 'the blob' } }), Promise.resolve({}), Promise.reject(new Error('revoked')), null]
      vi.stubGlobal('fetch', function (...args) { events.push(['fetch', args, this === undefined || this === globalThis]); const answer = answers.shift(); if (answer === null) throw new Error('no fetch'); return answer })
      for (const label of ['blob', 'no blob()', 'rejected', 'throws']) watch(events, label, () => helpers.localBlob(`blob:${label}`))
      await tick(events, 5); vi.unstubAllGlobals()
    })
  })
  it('makes the data URL of a Blob with a FileReader', async () => {
    await both(async (helpers, events) => {
      const readers = []
      vi.stubGlobal('FileReader', class { constructor(...args) { events.push(['new FileReader', args.length]); readers.push(this); this.result = null; this.error = null }
        readAsDataURL(...args) { events.push(['readAsDataURL', args, typeof this.onload, typeof this.onerror]); if (args[0] === 'unreadable') throw new Error('not a blob') } })
      for (const blob of ['first', 'second', 'unreadable']) watch(events, blob, () => helpers.blobDataURL(blob))
      await tick(events, 2)
      readers[0].result = 'data:first'; events.push(['onload', readers[0].onload({ type:'load' })]); readers[1].error = new Error('denied'); events.push(['onerror', readers[1].onerror({ type:'error' })])
      await tick(events, 3); readers[0].result = 'again'; readers[0].onload(); readers[0].onerror(); await tick(events, 2)
      vi.unstubAllGlobals()
    })
  })
  it('loads an image and settles with what the image answers', async () => {
    await both(async (helpers, events) => {
      const imageOf = (broken = false) => { const state = {}; return new Proxy(state, { set(target, key, value) { events.push(['set', key, typeof value === 'function' ? '<function>' : value]); if (broken && key === 'src') throw new Error('blocked'); target[key] = value; return true } }) }
      const loaded = imageOf(), failed = imageOf(), blocked = imageOf(true)
      watch(events, 'loaded', () => helpers.loadImage(loaded, 'blob:a')); watch(events, 'failed', () => helpers.loadImage(failed, 'blob:b')); watch(events, 'blocked', () => helpers.loadImage(blocked, 'blob:c'))
      await tick(events, 2); events.push(['onload', loaded.onload('load event')]); events.push(['onerror', failed.onerror('error event')]); await tick(events, 3)
      loaded.onerror('late'); await tick(events, 2)
    })
  })
})

it.skipIf(!process.env.SNAPSHOT_PROMISES_BENCH)('measures a deadline around an image that is already decoded', async () => {
  const median = values => values.slice().sort((a, b) => a - b)[values.length >> 1], waits = 20000, rounds = 21, decoded = Promise.resolve()
  const run = async wait => { const start = process.hrtime.bigint(); for (let n = 0; n < waits; n++) await wait(decoded, performance.now() + 1500); return Number(process.hrtime.bigint() - start) / waits }
  const times = { JavaScript:[], Rust:[] }, engines = { JavaScript:reference.beforeDeadline, Rust:rust.beforeDeadline }
  for (const name in engines) await run(engines[name])
  for (let round = 0; round < rounds; round++) for (const name of round % 2 ? ['Rust', 'JavaScript'] : ['JavaScript', 'Rust']) times[name].push(await run(engines[name]))
  console.log(`BENCH deadline around a settled decode (a timer set and cleared, three promises), medians of ${rounds} interleaved rounds of ${waits} waits | frozen JavaScript: ${median(times.JavaScript).toFixed(0)} ns | Rust: ${median(times.Rust).toFixed(0)} ns`)
}, 600000)
