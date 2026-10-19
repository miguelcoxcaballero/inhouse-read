import { describe, expect, it, vi } from 'vitest'
import { rustUI as ui } from './helpers/rust-ui-ready.js'
import * as frozen from './helpers/reference-foliate-close.js'

// FoliateReader.close() and its cursor reset moved to rust-ui foliate_reader.rs; the frozen original runs over a twin state.
function random(seed) { let state = seed >>> 0; return () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 2 ** 32 } }
function state(seed, log) {
  const next = random(seed), maybe = (p, value) => next() < p ? value : next() < 0.5 ? null : undefined
  const fail = name => () => { log.push(['throw', name]); throw new Error(`${name} failed`) }
  const step = name => next() < 0.06 ? fail(name) : (...args) => { log.push([name, ...args.map(String)]) }
  const container = maybe(0.8, { innerHTML:'<p>page</p>', classList:{ remove:next() < 0.05 ? undefined : step('classList.remove') } })
  return {
    speechCursor:maybe(0.7, { browsing:next() < 0.3, close:next() < 0.05 ? 7 : step('cursor.close'), reset:step('cursor.reset') }),
    lengthMetadata:{ words:3 }, resizeObserver:maybe(0.6, { disconnect:step('observer.disconnect') }), resizeTimer:next() < 0.5 ? 42 : undefined,
    detachGestures:next() < 0.04 ? undefined : step('detachGestures'),
    documentGestures:next() < 0.03 ? 5 : Array.from({ length:Math.floor(next() * 4) }, (_, i) => step(`document.${i}`)),
    view:maybe(0.7, { close:step('view.close'), remove:step('view.remove') }), turns:{ followPending:2, pageTurnPending:1 },
    pageTurn:null, container, preferences:{ flow:'paginated' }
  }
}
// Functions are new closures per run: compare their presence, and everything else by value.
const plainCopy = value => JSON.parse(JSON.stringify(value, (key, item) => typeof item === 'function' ? 'function' : item === undefined ? 'undefined' : item))
const snapshot = s => plainCopy({ ...s, pageTurn:s.pageTurn instanceof Promise ? 'promise' : s.pageTurn })
function run(action, seed) {
  const log = [], s = state(seed, log), timers = vi.spyOn(globalThis, 'clearTimeout').mockImplementation(id => log.push(['clearTimeout', String(id)]))
  let error = null
  try { action(s) } catch (caught) { error = caught.constructor.name + ':' + caught.message.replace(/^.*is not a function$/, 'not a function').replace(/^.*is not iterable.*$/, 'not iterable') }
  finally { timers.mockRestore() }
  return { log, error, state:snapshot(s) }
}

describe('foliate reader close in Rust', () => {
  it('closes 3000 reader states in the same order with the same results and failures', () => {
    let failures = 0
    for (let seed = 1; seed <= 3000; seed++) {
      const expected = run(frozen.close, seed), actual = run(s => ui.foliate_close(s), seed)
      expect(actual).toEqual(expected)
      if (expected.error) failures++
    }
    expect(failures).toBeGreaterThan(100)
  })
  it('resets the audible cursor unless the person is browsing', () => {
    for (let seed = 1; seed <= 500; seed++) expect(run(s => ui.foliate_reset_cursor(s), seed)).toEqual(run(frozen.resetCursor, seed))
  })
})
