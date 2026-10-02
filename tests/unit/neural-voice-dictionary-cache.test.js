// @vitest-environment node
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { DICTIONARY_CACHE_NAME, PACKAGED_DICTIONARIES, dictionaryNeeded, dictionaryUrl, fetchDictionary } from '../../src/js/readers/neural-voice/dictionary-cache.js'
import { createPhonemizer } from '../../src/js/readers/neural-voice/phonemizer.js'

const BASE = 'https://site.test/inhouse-read/neural-voice/phon/'
const UK = readFileSync(new URL('../../public/neural-voice/phon/dict/uk_dict', import.meta.url))
const BG = readFileSync(new URL('../../public/neural-voice/phon/dict/bg_dict', import.meta.url))
const DICT_URL = dictionaryUrl(BASE, 'uk')
afterEach(() => { vi.unstubAllGlobals() })

function fakeCache() {
  const entries = new Map()
  const cache = {
    match: vi.fn(async key => entries.get(key)?.clone()),
    put: vi.fn(async (key, response) => { entries.set(key, response.clone()) }),
    delete: vi.fn(async key => entries.delete(key))
  }
  const caches = { open: vi.fn(async () => cache) }
  return { cache, caches, entries }
}

describe('exact dictionaries of the shipped phonemizer', () => {
  it('matches the 16 embedded dictionaries in the actual shipped module file table', () => {
    const source = readFileSync(new URL('../../public/neural-voice/phon/piper_phonemize.mjs', import.meta.url), 'utf8')
    const names = [...new Set(Array.from(source.matchAll(/\/espeak-ng-data\/([a-z]+)_dict/g), match => match[1]))].sort()
    expect(names).toHaveLength(16)
    expect(PACKAGED_DICTIONARIES).toEqual(names)
    for (const name of names) expect(dictionaryNeeded(name)).toBeNull()
    for (const voice of ['en-us', 'es-419', 'pt-br', 'pt-pt', '', undefined, 'he', 'unknown']) expect(dictionaryNeeded(voice)).toBeNull()
  })

  it('pins every required external binary to its actual size and SHA-256', () => {
    const names = ['ar', 'bg', 'cmn', 'el', 'hi', 'no', 'ru', 'sr', 'uk', 'vi']
    for (const name of names) {
      const bytes = readFileSync(new URL(`../../public/neural-voice/phon/dict/${name}_dict`, import.meta.url))
      expect(dictionaryNeeded(name)).toEqual({ name, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') })
      expect(Object.isFrozen(dictionaryNeeded(name))).toBe(true)
    }
    expect(names.map(name => dictionaryNeeded(name).name)).toEqual(names)
  })

  it('resolves locale/case aliases and produces the exact worker DICT_URL', () => {
    for (const voice of ['nb', 'nn_NO', 'NO-no']) expect(dictionaryNeeded(voice)).toBe(dictionaryNeeded('no'))
    for (const voice of ['zh', 'zh_CN', 'CMN']) expect(dictionaryNeeded(voice)).toBe(dictionaryNeeded('cmn'))
    expect(dictionaryUrl(BASE, 'bg')).toBe(`${BASE}dict/bg_dict`)
  })
})

describe('persistent verified dictionary cache', () => {
  it('validates and stores a download, then serves fresh responses offline to a cold caller', async () => {
    const { cache, caches } = fakeCache(), fetch = vi.fn(async () => new Response(UK))
    const first = await fetchDictionary(DICT_URL, { caches, fetch })
    expect(new Uint8Array(await first.arrayBuffer())).toEqual(new Uint8Array(UK))
    expect(fetch).toHaveBeenCalledWith(DICT_URL, { signal: undefined })
    expect(caches.open).toHaveBeenCalledWith(DICTIONARY_CACHE_NAME)
    expect(cache.put).toHaveBeenCalledOnce()
    const offline = vi.fn(() => { throw new Error('offline') }), progress = []
    const second = await fetchDictionary(DICT_URL, { caches, fetch: offline, onProgress: entry => progress.push(entry) })
    const third = await fetchDictionary(DICT_URL, { caches, fetch: offline })
    expect(new Uint8Array(await second.arrayBuffer())).toEqual(new Uint8Array(UK))
    expect(new Uint8Array(await third.arrayBuffer())).toEqual(new Uint8Array(UK))
    expect(second.headers.get('content-length')).toBe(String(UK.length))
    expect(offline).not.toHaveBeenCalled()
    expect(progress.at(-1)).toEqual({ received: UK.length, total: UK.length, fraction: 1 })
    expect(cache.put).toHaveBeenCalledOnce()
  })

  it('streams exact progress and supports query strings on a verified basename', async () => {
    const { caches } = fakeCache(), progress = []
    const body = new ReadableStream({ start(controller) {
      controller.enqueue(UK.subarray(0, 100)); controller.enqueue(UK.subarray(100, 1000)); controller.enqueue(UK.subarray(1000)); controller.close()
    } })
    const response = await fetchDictionary(`${DICT_URL}?v=build`, { caches, fetch: async () => new Response(body), onProgress: entry => progress.push(entry) })
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array(UK))
    expect(progress.map(entry => entry.received)).toEqual([0, 100, 1000, UK.length, UK.length])
    expect(progress.every(entry => entry.total === UK.length && entry.fraction === entry.received / UK.length)).toBe(true)
  })

  it('validates responses without a stream in old runtimes', async () => {
    const { caches } = fakeCache()
    const response = await fetchDictionary(DICT_URL, { caches, fetch: async () => ({ ok: true, arrayBuffer: async () => UK.buffer.slice(UK.byteOffset, UK.byteOffset + UK.length) }) })
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array(UK))
  })

  it.each([
    ['truncated bytes', () => UK.subarray(1), /bytes instead/],
    ['oversized bytes', () => Buffer.concat([UK, Buffer.from([0])]), /expected size/],
    ['same-length corrupt bytes', () => { const bytes = Buffer.from(UK); bytes[0] ^= 1; return bytes }, /SHA-256/]
  ])('rejects %s before writing the cache', async (_, bytes, message) => {
    const { caches, cache } = fakeCache()
    await expect(fetchDictionary(DICT_URL, { caches, fetch: async () => new Response(bytes()) })).rejects.toMatchObject({ code: 'http', message: expect.stringMatching(message) })
    expect(cache.put).not.toHaveBeenCalled()
  })

  it('rejects and evicts a corrupt cached response without using it, and permits a later repair', async () => {
    const { caches, cache, entries } = fakeCache(), fetch = vi.fn(async () => new Response(UK))
    const bad = Buffer.from(UK); bad[bad.length - 1] ^= 1
    entries.set(DICT_URL, new Response(bad))
    await expect(fetchDictionary(DICT_URL, { caches, fetch })).rejects.toMatchObject({ code: 'http', message: expect.stringContaining('SHA-256') })
    expect(cache.delete).toHaveBeenCalledWith(DICT_URL)
    expect(fetch).not.toHaveBeenCalled()
    expect(entries.has(DICT_URL)).toBe(false)
    expect(new Uint8Array(await (await fetchDictionary(DICT_URL, { caches, fetch })).arrayBuffer())).toEqual(new Uint8Array(UK))
  })

  it('rejects an unverified name before opening storage or fetching', async () => {
    const { caches } = fakeCache(), fetch = vi.fn()
    for (const url of [dictionaryUrl(BASE, 'nl'), dictionaryUrl(BASE, 'unknown'), 'bad url']) {
      await expect(fetchDictionary(url, { caches, fetch })).rejects.toMatchObject({ code: 'http' })
    }
    expect(caches.open).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('distinguishes HTTP, offline, and interrupted-body failures without saving', async () => {
    const { caches, cache } = fakeCache()
    await expect(fetchDictionary(DICT_URL, { caches, fetch: async () => new Response(null, { status: 404 }) })).rejects.toMatchObject({ code: 'http' })
    await expect(fetchDictionary(DICT_URL, { caches, fetch: async () => { throw new TypeError('offline') } })).rejects.toMatchObject({ code: 'offline' })
    await expect(fetchDictionary(DICT_URL, { caches, fetch: async () => new Response(new ReadableStream({ start(controller) { controller.error(new Error('broken')) } })) })).rejects.toMatchObject({ code: 'http' })
    expect(cache.put).not.toHaveBeenCalled()
  })

  it('reports storage failures rather than pretending the dictionary is available offline', async () => {
    await expect(fetchDictionary(DICT_URL, { caches: null })).rejects.toMatchObject({ code: 'storage' })
    await expect(fetchDictionary(DICT_URL, { caches: { open: async () => { throw new Error('blocked') } } })).rejects.toMatchObject({ code: 'storage' })
    const { caches, cache } = fakeCache()
    cache.put.mockRejectedValue(new Error('quota'))
    await expect(fetchDictionary(DICT_URL, { caches, fetch: async () => new Response(UK) })).rejects.toMatchObject({ code: 'storage' })
  })
})

describe('dictionary cancellation', () => {
  it('rejects an already aborted request without touching storage or network', async () => {
    const { caches } = fakeCache(), fetch = vi.fn(), controller = new AbortController()
    controller.abort()
    await expect(fetchDictionary(DICT_URL, { caches, fetch, signal: controller.signal })).rejects.toMatchObject({ code: 'aborted' })
    expect(caches.open).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('aborts a stalled fetch even if the fetch implementation ignores the signal', async () => {
    const { caches, cache } = fakeCache(), controller = new AbortController()
    const fetch = vi.fn(() => new Promise(() => {}))
    const pending = fetchDictionary(DICT_URL, { caches, fetch, signal: controller.signal })
    const rejected = expect(pending).rejects.toMatchObject({ code: 'aborted' })
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce())
    controller.abort()
    await rejected
    expect(cache.put).not.toHaveBeenCalled()
  })

  it('aborts and cancels a stalled body without waiting for cancellation to finish', async () => {
    const { caches, cache } = fakeCache(), controller = new AbortController()
    const reader = { read: vi.fn(() => new Promise(() => {})), cancel: vi.fn(() => new Promise(() => {})), releaseLock: vi.fn() }
    const fetch = async () => ({ ok: true, body: { getReader: () => reader } })
    const pending = fetchDictionary(DICT_URL, { caches, fetch, signal: controller.signal })
    const rejected = expect(pending).rejects.toMatchObject({ code: 'aborted' })
    await vi.waitFor(() => expect(reader.read).toHaveBeenCalledOnce())
    controller.abort()
    await rejected
    expect(reader.cancel).toHaveBeenCalled()
    expect(reader.releaseLock).toHaveBeenCalledOnce()
    expect(cache.put).not.toHaveBeenCalled()
  })

  it('honors cancellation after the last byte and before committing storage', async () => {
    const { caches, cache } = fakeCache(), controller = new AbortController()
    await expect(fetchDictionary(DICT_URL, { caches, fetch: async () => new Response(UK), signal: controller.signal,
      onProgress: entry => { if (entry.received === UK.length) controller.abort() }
    })).rejects.toMatchObject({ code: 'aborted' })
    expect(cache.put).not.toHaveBeenCalled()
  })
})

describe('cold phonemizer uses the installation dictionary cache', () => {
  it('loads Bulgarian without network across independent phonemizers and module rebuilds', async () => {
    const { caches } = fakeCache(), url = dictionaryUrl(BASE, 'bg')
    await fetchDictionary(url, { caches, fetch: async () => new Response(BG) })
    const offline = vi.fn(() => { throw new Error('offline') }), written = []
    vi.stubGlobal('caches', caches); vi.stubGlobal('fetch', offline)
    const factory = vi.fn(async hooks => ({
      FS_analyzePath: () => ({ exists: false }), FS_createDataFile: (...args) => written.push(args),
      callMain: () => hooks.print(JSON.stringify({ phoneme_ids: [1, 0, 14, 0, 2] }))
    }))
    for (let cold = 0; cold < 2; cold++) {
      const phonemizer = await createPhonemizer({ base: BASE, importModule: async () => ({ default: factory }), rebuildEvery: 1 })
      try {
        expect(await phonemizer.phonemize('Здравей.', 'bg')).toEqual([1, 0, 14, 0, 2])
        expect(await phonemizer.phonemize('Отново.', 'bg')).toEqual([1, 0, 14, 0, 2])
      } finally { phonemizer.destroy() }
    }
    expect(factory).toHaveBeenCalledTimes(4)
    expect(written).toHaveLength(4)
    for (const [, name, bytes] of written) {
      expect(name).toBe('bg_dict')
      expect(bytes).toEqual(new Uint8Array(BG))
    }
    expect(offline).not.toHaveBeenCalled()
  })

  it('preserves explicit fetchFile injection for existing doubles', async () => {
    const fetchFile = vi.fn(async () => new Response(Uint8Array.of(1, 2, 3)))
    const phonemizer = await createPhonemizer({ base: BASE, fetchFile, importModule: async () => ({ default: async hooks => ({
      FS_createDataFile: vi.fn(), callMain: () => hooks.print(JSON.stringify({ phoneme_ids: [1, 0, 14, 0, 2] }))
    }) }) })
    try { expect(await phonemizer.phonemize('a', 'ru')).toEqual([1, 0, 14, 0, 2]) } finally { phonemizer.destroy() }
    expect(fetchFile).toHaveBeenCalledWith(dictionaryUrl(BASE, 'ru'))
  })
})
