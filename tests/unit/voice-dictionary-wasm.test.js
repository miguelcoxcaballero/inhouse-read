// @vitest-environment node
import './helpers/rust-ui-ready.js'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as moved from '../../src/js/readers/neural-voice/dictionary-cache.js'
import * as frozen from './helpers/reference-dictionary-cache.js'
import { rustUI } from './helpers/rust-ui-ready.js'

// The dictionary descriptors and the verified, cached download moved to rust-ui voice_dictionary.rs (built into the voice
// module for the synthesis worker and into the UI module for the voice download). reference-dictionary-cache.js is the
// frozen original: every scenario runs against both with fresh doubles and their traces must be identical.
const BASE = 'https://site.test/inhouse-read/neural-voice/phon/'
const UK = readFileSync(new URL('../../public/neural-voice/phon/dict/uk_dict', import.meta.url))
const NO = readFileSync(new URL('../../public/neural-voice/phon/dict/no_dict', import.meta.url))
const URL_UK = `${BASE}dict/uk_dict`
afterEach(() => { vi.unstubAllGlobals() })

const describeError = error => error && typeof error === 'object'
  ? { kind:error.constructor?.name, code:error.code, message:error.message, own:Object.keys(error), cause:describeError(error.cause) }
  : error
const digest = bytes => createHash('sha256').update(new Uint8Array(bytes)).digest('hex')

function doubles(trace, { entries = new Map(), match, put, open, del } = {}) {
  const cache = {
    match: async key => { trace.push(['match', key]); if (match) return match(key); return entries.get(key)?.clone() },
    put: async (key, response) => { trace.push(['put', key, response.headers.get('content-length'), response.headers.get('content-type')]); if (put) return put(); entries.set(key, response.clone()) },
    delete: key => { trace.push(['delete', key]); if (del) return del(); return Promise.resolve(entries.delete(key)) }
  }
  const caches = { open: name => { trace.push(['open', name]); return open ? open() : Promise.resolve(cache) } }
  return { cache, caches, entries }
}
async function run(implementation, scenario) {
  const trace = []
  const options = scenario(trace)
  const { url, ...rest } = options
  try {
    const response = await implementation.fetchDictionary('url' in options ? url : URL_UK, 'options' in rest ? rest.options : rest)
    const bytes = await response.arrayBuffer()
    trace.push(['resolved', response.constructor.name, bytes.byteLength, digest(bytes), [...response.headers]])
  } catch (error) { trace.push(['rejected', describeError(error)]) }
  return trace
}
const same = async scenario => {
  const [mine, theirs] = [await run(moved, scenario), await run(frozen, scenario)]
  expect(mine).toEqual(theirs)
  return mine
}
const stream = (...parts) => new ReadableStream({ start(controller) { for (const part of parts) controller.enqueue(part); controller.close() } })
const progress = trace => entry => trace.push(['progress', entry.received, entry.total, entry.fraction, Object.keys(entry)])

describe('dictionary descriptors in Rust', () => {
  const voices = ['ar', 'bg', 'cmn', 'el', 'hi', 'no', 'ru', 'sr', 'uk', 'vi', 'nb', 'nn', 'nn_NO', 'NO-no', 'zh', 'zh_CN', 'zh-Hant-TW', 'CMN', 'Uk-UA',
    'en-us', 'es-419', 'pt-br', 'he', 'unknown', '', '-', '_ru', 'ru_', 'ru-', 'r', 'RU', 'ﬀ', 'İ', 'K', 'constructor', '__proto__', 'toString',
    'hasOwnProperty', 'valueOf', 'x\ud800', 'K', 0, 1, NaN, true, false, null, undefined, ['uk'], ['nb', 'x'], { toString:() => 'bg-BG' }, new String('vi'), Symbol('ru')]
  it('returns the same descriptor (or null) as the original for every input', () => {
    for (const voice of voices) {
      const mine = moved.dictionaryNeeded(voice), theirs = frozen.dictionaryNeeded(voice)
      expect(mine).toEqual(theirs)
      if (mine) { expect(Object.isFrozen(mine)).toBe(true); expect(Object.keys(mine)).toEqual(['name', 'bytes', 'sha256']) }
    }
  })
  it('hands out one frozen object per dictionary, aliases included', () => {
    expect(moved.dictionaryNeeded('nb')).toBe(moved.dictionaryNeeded('no'))
    expect(moved.dictionaryNeeded('zh_TW')).toBe(moved.dictionaryNeeded('cmn'))
    expect(rustUI.voice_dictionary_needed('uk')).toEqual(frozen.dictionaryNeeded('uk'))
    expect(rustUI.voice_dictionary_needed('nb')).toBe(rustUI.voice_dictionary_needed('nn'))
  })
  it('throws like the original for a voice whose conversion throws', () => {
    const evil = { toString() { throw new RangeError('no') } }
    expect(() => moved.dictionaryNeeded(evil)).toThrow(RangeError)
    expect(() => frozen.dictionaryNeeded(evil)).toThrow(RangeError)
  })
  it('builds the same URL in the UI module, keeping every UTF-16 unit', () => {
    for (const [base, name] of [[BASE, 'bg'], ['', 'ru'], ['x\ud800/', 'uk'], [7, null], [undefined, { toString:() => 'vi' }]]) {
      expect(rustUI.voice_dictionary_url(base, name)).toBe(frozen.dictionaryUrl(base, name))
      expect(moved.dictionaryUrl(base, name)).toBe(frozen.dictionaryUrl(base, name))
    }
    expect(() => rustUI.voice_dictionary_url(Symbol('b'), 'uk')).toThrow(TypeError)
    expect(() => frozen.dictionaryUrl(Symbol('b'), 'uk')).toThrow(TypeError)
    expect([moved.DICTIONARY_CACHE_NAME, moved.PACKAGED_DICTIONARIES]).toEqual([frozen.DICTIONARY_CACHE_NAME, frozen.PACKAGED_DICTIONARIES])
  })
})

describe('the verified dictionary cache in Rust behaves like the original', () => {
  it('downloads, stores and then serves offline', async () => {
    const entries = new Map()
    const first = await same(trace => ({ ...doubles(trace, { entries: new Map() }), fetch: async (...args) => { trace.push(['fetch', ...args.map(arg => typeof arg === 'object' ? Object.keys(arg) : arg)]); return new Response(UK) }, onProgress: progress(trace) }))
    expect(first.at(-1)[0]).toBe('resolved')
    const seeded = trace => { const made = doubles(trace, { entries }); return { ...made, fetch: () => { throw new Error('offline') }, onProgress: progress(trace) } }
    await run(frozen, trace => ({ ...doubles(trace, { entries }), fetch: async () => new Response(UK) }))
    expect((await same(seeded)).some(step => step[0] === 'fetch')).toBe(false)
  })
  it('streams exact progress, with a query string, a missing stream and the no-dictionary Norwegian', async () => {
    await same(trace => ({ url:`${URL_UK}?v=build`, ...doubles(trace), fetch: async () => new Response(stream(UK.subarray(0, 100), UK.subarray(100, 1000), UK.subarray(1000))), onProgress: progress(trace) }))
    await same(trace => ({ ...doubles(trace), fetch: async () => ({ ok:true, arrayBuffer: async () => UK.buffer.slice(UK.byteOffset, UK.byteOffset + UK.length) }), onProgress: progress(trace) }))
    await same(trace => ({ url:`${BASE}dict/no_dict#frag`, ...doubles(trace), fetch: async () => new Response(NO), onProgress: progress(trace) }))
    await same(trace => ({ url:'dict/uk_dict', ...doubles(trace), fetch: async () => new Response(UK) }))
  })
  it('rejects bad bodies before writing the cache', async () => {
    const corrupt = Buffer.from(UK); corrupt[0] ^= 1
    for (const bytes of [UK.subarray(1), Buffer.concat([UK, Buffer.from([0])]), corrupt, new Uint8Array(0)]) {
      await same(trace => ({ ...doubles(trace), fetch: async () => new Response(bytes), onProgress: progress(trace) }))
      await same(trace => ({ ...doubles(trace), fetch: async () => ({ ok:true, body:null, arrayBuffer: async () => new Uint8Array(bytes).buffer }), onProgress: progress(trace) }))
    }
  })
  it('evicts corrupt or failed cached responses', async () => {
    const bad = Buffer.from(UK); bad[bad.length - 1] ^= 1
    const cached = response => trace => { const entries = new Map([[URL_UK, response()]]); return { ...doubles(trace, { entries }), fetch: async () => new Response(UK) } }
    await same(cached(() => new Response(bad)))
    await same(cached(() => new Response(UK, { status:500 })))
    await same(trace => ({ ...doubles(trace, { match: () => ({ ok:true, arrayBuffer: () => Promise.reject(new Error('gone')) }) }), fetch: async () => new Response(UK) }))
    await same(trace => ({ ...doubles(trace, { match: () => ({ ok:true, arrayBuffer: async () => UK.buffer.slice(UK.byteOffset, UK.byteOffset + 9) }), del: () => Promise.reject(new Error('locked')) }), fetch: async () => new Response(UK) }))
    await same(trace => ({ ...doubles(trace, { match: () => ({ ok:false }), del: () => { throw new Error('sync delete') } }), fetch: async () => new Response(UK) }))
  })
  it('rejects unverified names and invalid URLs before storage or network', async () => {
    for (const url of [`${BASE}dict/nl_dict`, `${BASE}dict/unknown_dict`, `${BASE}dict/UK_dict`, `${BASE}dict/uk_dict/`, `${BASE}dict/u1_dict`, `${BASE}dict/_dict`, 'bad url', 'http://[', '', null, undefined, 7, { toString:() => URL_UK }])
      await same(trace => ({ url, ...doubles(trace), fetch: async () => new Response(UK) }))
  })
  it('distinguishes HTTP, offline and interrupted failures', async () => {
    const fetches = [async () => new Response(null, { status:404 }), async () => { throw new TypeError('offline') }, () => { throw new Error('sync') },
      async () => new Response(new ReadableStream({ start(controller) { controller.error(new Error('broken')) } })), async () => null, async () => ({ ok:false }),
      async () => ({ ok:false, status:null }), async () => { const error = new Error('aborted fetch'); error.name = 'AbortError'; throw error },
      // A chunk that is not bytes (a non-numeric length would loop on settled reads in both: not exercised).
      async () => { let sent = false; return { ok:true, body:{ getReader: () => ({ read: async () => sent ? { done:true } : (sent = true, { done:false, value:new Uint8Array(9) }), cancel: async () => {} }) } } },
      async () => ({ ok:true, body:{ getReader: () => ({ read: async () => null, cancel: async () => { throw new Error('cancel') } }) } }),
      async () => ({ ok:true, body:{ getReader: 5 } }), null, 5, 'fetch']
    for (const fetch of fetches) await same(trace => ({ ...doubles(trace), fetch, onProgress: progress(trace) }))
  })
  it('reports storage failures and option shapes the same way', async () => {
    await same(() => ({ caches:null }))
    await same(() => ({ caches:{} }))
    await same(() => ({ caches:{ open: async () => { throw new Error('blocked') } } }))
    await same(() => ({ caches:{ open: () => { throw new Error('sync blocked') } } }))
    await same(trace => ({ ...doubles(trace, { match: () => Promise.reject(new Error('unreadable')) }), fetch: async () => new Response(UK) }))
    await same(trace => ({ ...doubles(trace, { put: () => Promise.reject(new Error('quota')) }), fetch: async () => new Response(UK) }))
    await same(() => ({ options:undefined }))
    await same(() => ({ options:5 }))
    const nullish = [await run(moved, () => ({ options:null })), await run(frozen, () => ({ options:null }))]
    expect(nullish.map(trace => [trace[0][0], trace[0][1].kind])).toEqual([['rejected', 'TypeError'], ['rejected', 'TypeError']])
  })
  it('fails the same way when a progress callback throws or checksum verification is unavailable', async () => {
    await same(trace => ({ ...doubles(trace), fetch: async () => new Response(UK), onProgress: () => { throw new Error('first') } }))
    await same(trace => ({ ...doubles(trace), fetch: async () => new Response(stream(UK)), onProgress: entry => { if (entry.received) throw new Error('later') } }))
    await same(trace => ({ ...doubles(trace), fetch: async () => new Response(UK), onProgress:'nope' }))
    vi.stubGlobal('crypto', {})
    await same(trace => ({ ...doubles(trace), fetch: async () => new Response(UK) }))
  })
})

describe('dictionary cancellation in Rust behaves like the original', () => {
  it('rejects an already aborted request without touching storage or network', async () => {
    await same(trace => { const controller = new AbortController(); controller.abort(); return { ...doubles(trace), fetch: () => trace.push(['fetch']), signal:controller.signal } })
  })
  it('aborts after the last byte and before committing storage, and during the cache steps', async () => {
    await same(trace => { const controller = new AbortController(); return { ...doubles(trace), fetch: async () => new Response(UK), signal:controller.signal, onProgress: entry => { trace.push(['progress', entry.received]); if (entry.received === UK.length) controller.abort() } } })
    await same(trace => { const controller = new AbortController(); return { ...doubles(trace, { open: () => { controller.abort(); return new Promise(() => {}) } }), fetch: async () => new Response(UK), signal:controller.signal } })
    await same(trace => { const controller = new AbortController(); return { ...doubles(trace, { match: () => { controller.abort(); return undefined } }), fetch: async () => new Response(UK), signal:controller.signal } })
    await same(trace => { const controller = new AbortController(); return { ...doubles(trace, { put: () => { controller.abort() } }), fetch: async () => new Response(UK), signal:controller.signal } })
  })
  for (const [label, makeFetch] of [
    ['a stalled fetch that ignores its signal', () => () => new Promise(() => {})],
    ['a stalled body without waiting for its cancellation', trace => () => Promise.resolve({ ok:true, body:{ getReader: () => ({
      read: () => { trace.push(['read']); return new Promise(() => {}) }, cancel: () => { trace.push(['cancel']); return new Promise(() => {}) }, releaseLock: () => trace.push(['release']) }) } })]
  ]) it(`aborts ${label}`, async () => {
    const traces = []
    for (const implementation of [moved, frozen]) {
      const trace = [], controller = new AbortController(), made = doubles(trace)
      const fetch = makeFetch(trace), counted = (...args) => { trace.push(['fetch', args[0]]); return fetch(...args) }
      const pending = implementation.fetchDictionary(URL_UK, { ...made, fetch:counted, signal:controller.signal })
      await vi.waitFor(() => expect(trace.some(step => step[0] === (label.includes('body') ? 'read' : 'fetch'))).toBe(true))
      controller.abort()
      try { await pending; trace.push(['resolved']) } catch (error) { trace.push(['rejected', describeError(error)]) }
      traces.push(trace)
    }
    expect(traces[0]).toEqual(traces[1])
    expect(traces[0].at(-1)[1].code).toBe('aborted')
  })
})

describe('the voice download fetches its dictionary through the UI module', () => {
  it('needs the same dictionaries for every catalogued espeak voice', () => {
    for (const voice of ['bg', 'ru', 'uk', 'sr', 'el', 'hi', 'vi', 'ar', 'cmn', 'no', 'nb', 'es', 'en-us', 'de'])
      expect(rustUI.voice_dictionary_needed(voice)).toEqual(frozen.dictionaryNeeded(voice))
  })
  it('reads the same verified Response from a cache filled by the original', async () => {
    const trace = [], entries = new Map(), made = doubles(trace, { entries })
    await frozen.fetchDictionary(URL_UK, { ...made, fetch: async () => new Response(UK) })
    const response = await rustUI.voice_dictionary_fetch(URL_UK, { ...made, fetch: () => { throw new Error('offline') } })
    expect(digest(await response.arrayBuffer())).toBe(digest(UK))
  })
})
