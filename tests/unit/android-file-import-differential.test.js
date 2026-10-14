import { describe, it, expect, afterEach, vi } from 'vitest'
import './helpers/rust-ui-ready.js'
import { initAndroidFileImports } from '../../src/js/android-file-import.js'
import { initAndroidFileImports as reference } from './helpers/reference-android-file-import.js'

// The Rust inbox importer against the original on seeded inboxes: sizes, chunking, every kind of
// bad entry and bad base64, storage failures, importer callbacks that reject, a reader transition
// (canImport), a hidden page and a stop at any moment. Fake timers; every bridge call, callback and
// the exact bytes handed over must be identical and in the same order.
function random(seed) {
  let state = seed >>> 0
  return () => { state = (state + 0x6D2B79F5) >>> 0; let t = state; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296 }
}
const pick = (rng, list) => list[Math.floor(rng() * list.length)]
const text = bytes => btoa(String.fromCharCode(...bytes))

function plan(seed) {
  const rng = random(seed)
  const entries = Array.from({ length: 1 + Math.floor(rng() * 3) }, (_, index) => {
    const size = pick(rng, [1, 3, 4, 5, 9, 10, 4, 5, 9, 6, 7, 0, -2, 2.5, '4', null, undefined, 2 ** 53])
    return { id: pick(rng, [`e${index}`, `e${index}`, `e${index}`, index]), name: `Book ${index}.pdf`, mimeType: pick(rng, ['application/pdf', '', undefined]), size,
      ...(rng() < .06 ? { error: 'Native refused it.' } : {}), step: pick(rng, [1, 2, 2, 3, 4]), glitch: pick(rng, [null, null, null, null, null, null, null, 'whitespace', 'nopad', 'empty', 'garbage', 'long', 'url', 'unicode']) }
  })
  const actions = Array.from({ length: 6 + Math.floor(rng() * 6) }, () => ({ kind: pick(rng, ['advance', 'advance', 'advance', 'advance', 'visibility', 'hidden', 'shown', 'busy', 'free', 'late', 'stop']), n: Math.floor(rng() * 3), r: rng() }))
  return { entries, actions, onFile: pick(rng, ['resolve', 'resolve', 'resolve', 'reject', 'storage', 'throw']), onError: pick(rng, ['ok', 'ok', 'throws', 'none']),
    activity: rng() < .8, canImport: rng() < .8, pending: pick(rng, ['normal', 'normal', 'normal', 'notjson', 'object', 'empty']), poll: pick(rng, [5, 20, 100]) }
}

async function run(init, seed) {
  const scenario = plan(seed)
  const log = []
  const inbox = scenario.entries.map(entry => ({ ...entry }))
  const data = new Map(scenario.entries.map(entry => [entry.id, Uint8Array.from({ length: Math.max(0, Math.min(12, Number(entry.size) || 0)) + 1 }, (_, i) => (i * 7 + 3) & 255)]))
  let allowed = scenario.canImport, hidden = false
  Object.defineProperty(document, 'visibilityState', { get: () => hidden ? 'hidden' : 'visible', configurable: true })
  const bridge = {
    pending() {
      log.push(['pending'])
      if (scenario.pending === 'notjson') return '{oops'
      if (scenario.pending === 'object') return '{"a":1}'
      if (scenario.pending === 'empty') return '[]'
      return JSON.stringify(inbox)
    },
    readChunk(id, offset) {
      log.push(['readChunk', id, offset])
      const entry = scenario.entries.find(candidate => candidate.id === id)
      const bytes = data.get(id) || new Uint8Array()
      const chunk = bytes.slice(offset, offset + (entry?.step || 2))
      switch (entry?.glitch) {
        case 'empty': return ''
        case 'garbage': return '***'
        case 'whitespace': return text(chunk).replace(/(.{2})/g, '$1 \n')
        case 'long': return text(new Uint8Array(40))
        case 'nopad': return text(chunk).replace(/=+$/, '')
        case 'url': return text(chunk).replace(/\+/g, '-')
        case 'unicode': return 'é' + text(chunk)
        default: return text(chunk)
      }
    },
    acknowledge(id) { log.push(['acknowledge', id]); const at = inbox.findIndex(entry => entry.id === id); if (at >= 0) inbox.splice(at, 1) }
  }
  let release
  const options = {
    bridge, pollMs: scenario.poll, canImport: () => { log.push(['canImport', allowed]); return allowed },
    onFile: async file => {
      log.push(['onFile', file.name, file.type, [...new Uint8Array(await file.arrayBuffer())]])
      if (scenario.onFile === 'resolve') return
      if (scenario.onFile === 'throw') throw 'plain text'
      const failure = Object.assign(new Error('Importer said no'), scenario.onFile === 'storage' ? { code: 'LOCAL_BOOK_STORAGE_FAILED' } : {})
      throw failure
    },
    ...(scenario.onError === 'none' ? {} : { onError: async error => { log.push(['onError', error?.name, error?.message, error?.code]); if (scenario.onError === 'throws') throw new Error('handler failed') } }),
    ...(scenario.activity ? { onActivity: active => log.push(['activity', active]) } : {})
  }
  vi.useFakeTimers()
  const rejections = []
  const trap = reason => rejections.push(String(reason?.message ?? reason))
  process.on('unhandledRejection', trap)
  let stop
  try {
    stop = init(options)
    for (const action of scenario.actions) {
      switch (action.kind) {
        case 'advance': await vi.advanceTimersByTimeAsync(action.n * 7 + 3); break
        case 'visibility': document.dispatchEvent(new Event('visibilitychange')); break
        case 'hidden': hidden = true; document.dispatchEvent(new Event('visibilitychange')); break
        case 'shown': hidden = false; document.dispatchEvent(new Event('visibilitychange')); break
        case 'busy': allowed = false; break
        case 'free': allowed = true; break
        case 'late': inbox.push({ id: `late${action.n}`, name: 'Late.epub', mimeType: 'application/epub+zip', size: 4, step: 2, glitch: null }); data.set(`late${action.n}`, new Uint8Array([1, 2, 3, 4, 5])); scenario.entries.push(inbox.at(-1)); break
        case 'stop': stop(); break
      }
      await vi.advanceTimersByTimeAsync(1)
      log.push(['tick'])
    }
    await vi.advanceTimersByTimeAsync(scenario.poll * 4)
    stop()
    await vi.advanceTimersByTimeAsync(scenario.poll * 2)
  } finally {
    process.off('unhandledRejection', trap)
    vi.useRealTimers()
    delete document.visibilityState
  }
  return { log, rejections }
}

afterEach(() => { vi.useRealTimers(); delete document.visibilityState })

const SCENARIOS = Number(process.env.IMPORT_DIFFERENTIAL_SCENARIOS || 300)
describe('Android inbox importer (Rust) against the original', () => {
  it(`makes the same bridge calls, callbacks and bytes through ${SCENARIOS} seeded inboxes`, async () => {
    let imported = 0, reported = 0, acknowledged = 0
    for (let seed = 1; seed <= SCENARIOS; seed++) {
      const expected = await run(reference, seed)
      const actual = await run(initAndroidFileImports, seed)
      if (process.env.IMPORT_DEBUG && JSON.stringify(actual) !== JSON.stringify(expected)) console.log(seed, JSON.stringify(plan(seed).actions), JSON.stringify(plan(seed).entries), plan(seed).poll, JSON.stringify(expected.log), JSON.stringify(actual.log))
      expect(actual, `scenario ${seed}`).toEqual(expected)
      imported += expected.log.filter(entry => entry[0] === 'onFile').length
      reported += expected.log.filter(entry => entry[0] === 'onError').length
      acknowledged += expected.log.filter(entry => entry[0] === 'acknowledge').length
    }
    expect(imported).toBeGreaterThan(SCENARIOS / 6)
    expect(reported).toBeGreaterThan(SCENARIOS / 4)
    expect(acknowledged).toBeGreaterThan(SCENARIOS / 4)
  }, 280_000)
})
