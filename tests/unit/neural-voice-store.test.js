// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { VoiceStore, CACHE_NAME } from '../../src/js/readers/neural-voice/store.js'
import { voiceUrls } from '../../src/js/readers/neural-voice/catalog.js'
import { fakeCaches } from './neural-fakes.js'

const BASE = 'https://mirror.test/voices/'
const ID = 'es_MX-claude-high'
const URLS = voiceUrls(ID, BASE)
const bytes = Uint8Array.from({ length: 100_000 }, (_, i) => i % 251)
const config = { audio: { sample_rate: 22050 }, num_speakers: 1 }

/** A server-ish fetch. `script` decides per call; by default a normal one with Range support. */
function fakeNetwork({ body = bytes, catalogueSize, onCall, failures = [] } = {}) {
  const calls = []
  const stream = (data, { dieAt, stallAt } = {}) => {
    let at = 0
    return new ReadableStream({
      pull(controller) {
        if (stallAt !== undefined && at >= stallAt) return new Promise(() => {}) // the connection goes silent without closing
        if (dieAt !== undefined && at >= dieAt) return controller.error(new TypeError('network error'))
        if (at >= data.length) return controller.close()
        const end = Math.min(data.length, at + 10_000, dieAt ?? Infinity, stallAt ?? Infinity)
        controller.enqueue(data.slice(at, end)); at = end
      }
    })
  }
  const fetch = async (url, init = {}) => {
    const call = { url, range: init.headers?.range, ifRange: init.headers?.['if-range'], signal: init.signal }
    calls.push(call)
    onCall?.(call)
    if (init.signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' })
    const failure = failures.shift()
    if (failure === 'throw') throw new TypeError('Failed to fetch')
    if (url === URLS.catalogue) {
      if (catalogueSize === null) return new Response('nope', { status: 404 })
      return Response.json({ [ID]: { files: { [URLS.key]: { size_bytes: catalogueSize ?? body.length } } } })
    }
    if (url === URLS.config) return new Response(JSON.stringify(config), { headers: { 'content-type': 'application/json' } })
    if (typeof failure === 'number') return new Response('x', { status: failure })
    const range = /bytes=(\d+)-/.exec(call.range || '')
    const start = range ? Number(range[1]) : 0
    if (range && failure !== 'ignore-range') {
      return new Response(stream(body.slice(start)), { status: 206, headers: { 'content-length': String(body.length - start), 'content-range': `bytes ${start}-${body.length - 1}/${body.length}`, etag: '"v1"' } })
    }
    const die = failure && failure.dieAt
    return new Response(stream(body, { dieAt: die, stallAt: failure && failure.stallAt }), { status: 200, headers: { 'content-length': String(body.length), etag: '"v1"' } })
  }
  return { fetch, calls }
}

const makeStore = (extra = {}) => {
  const caches = fakeCaches()
  const net = extra.net || fakeNetwork()
  const store = new VoiceStore({ caches, fetch: net.fetch, base: () => BASE, storage: { persist: vi.fn(async () => true) }, sleep: async () => {}, online: () => true, ...extra.deps })
  return { store, caches, net }
}

describe('VoiceStore download', () => {
  it('streams the model with progress into Cache Storage, model last, and reads it back', async () => {
    const { store, caches } = makeStore()
    const progress = []
    const result = await store.download(ID, { onProgress: p => progress.push(p) })
    expect(result.bytes).toBe(bytes.length)
    expect(progress.length).toBeGreaterThan(5)
    const fractions = progress.map(p => p.fraction)
    expect(fractions).toEqual([...fractions].sort((a, b) => a - b))
    expect(progress[0].total).toBe(bytes.length)
    expect(fractions.at(-1)).toBe(1)
    expect([...caches.stores.keys()]).toEqual([CACHE_NAME])
    expect(await store.list()).toEqual(new Set([ID]))
    expect(await store.has(ID)).toBe(true)
    expect(new Uint8Array(await store.readModel(ID))).toEqual(bytes)
    expect(await store.readConfig(ID)).toEqual(config)
    expect(store.storage.persist).toHaveBeenCalled()
  })

  it('writes the model after the config, so a voice is never "installed" half way', async () => {
    const { store, caches } = makeStore()
    const order = []
    const cache = await caches.open(CACHE_NAME)
    const original = caches.open
    caches.open = async name => { const c = await original(name); return { ...c, put: async (request, response) => { order.push(request.endsWith('.json') ? 'config' : 'model'); return c.put(request, response) } } }
    await store.download(ID)
    expect(order).toEqual(['config', 'model'])
    expect(cache).toBeTruthy()
  })

  it('checks the size against the repository catalogue (voices.json)', async () => {
    const { store } = makeStore({ net: fakeNetwork({ catalogueSize: bytes.length + 5 }) })
    await expect(store.download(ID)).rejects.toMatchObject({ code: 'http', message: expect.stringContaining('size') })
    expect(await store.has(ID)).toBe(false)
    expect((await store.list()).size).toBe(0)
  })

  it('still downloads when the catalogue cannot be reached', async () => {
    const { store } = makeStore({ net: fakeNetwork({ catalogueSize: null }) })
    await store.download(ID)
    expect(await store.has(ID)).toBe(true)
  })

  it('aborts on request and leaves nothing behind', async () => {
    const controller = new AbortController()
    const { store } = makeStore()
    const promise = store.download(ID, { signal: controller.signal, onProgress: p => { if (p.fraction > 0.3) controller.abort() } })
    await expect(promise).rejects.toMatchObject({ code: 'aborted' })
    expect(await store.has(ID)).toBe(false)
    expect((await store.list()).size).toBe(0)
  })

  it('rejects at once when already aborted or offline, without touching the network', async () => {
    const { store, net } = makeStore({ deps: { online: () => false } })
    await expect(store.download(ID)).rejects.toMatchObject({ code: 'offline' })
    const controller = new AbortController(); controller.abort()
    const other = makeStore()
    await expect(other.store.download(ID, { signal: controller.signal })).rejects.toMatchObject({ code: 'aborted' })
    expect(net.calls.length).toBe(0)
    expect(other.net.calls.length).toBe(0)
  })

  it('resumes a dropped connection with a Range request (and If-Range) instead of starting over', async () => {
    const net = fakeNetwork({ failures: [undefined, undefined, { dieAt: 40_000 }] })
    // call order: config (consumes failure #1), catalogue (#2), model first try (#3, dies after 40 kB)
    const { store } = makeStore({ net })
    await store.download(ID)
    const modelCalls = net.calls.filter(c => c.url === URLS.model)
    expect(modelCalls.length).toBe(2)
    expect(modelCalls[0].range).toBeUndefined()
    expect(modelCalls[1].range).toBe('bytes=40000-')
    expect(modelCalls[1].ifRange).toBe('"v1"')
    expect(new Uint8Array(await store.readModel(ID))).toEqual(bytes)  // no byte lost, none repeated
  })

  it('gives up on a connection that goes silent (no byte for stallMs, no close) and resumes with a Range request', async () => {
    const net = fakeNetwork({ failures: [undefined, undefined, { stallAt: 40_000 }] })
    const { store } = makeStore({ net, deps: { stallMs: 40 } })
    await store.download(ID)
    const modelCalls = net.calls.filter(c => c.url === URLS.model)
    expect(modelCalls.map(c => c.range)).toEqual([undefined, 'bytes=40000-'])
    expect(new Uint8Array(await store.readModel(ID))).toEqual(bytes)
  })

  it('a silent connection does not outlive an abort', async () => {
    const net = fakeNetwork({ failures: [undefined, undefined, { stallAt: 10_000 }] })
    const { store } = makeStore({ net, deps: { stallMs: 60_000 } })
    const controller = new AbortController()
    const promise = store.download(ID, { signal: controller.signal, onProgress: p => { if (p.received >= 10_000) setTimeout(() => controller.abort(), 5) } })
    await expect(promise).rejects.toMatchObject({ code: 'aborted' })
  })

  it('starts again cleanly when the server ignores Range', async () => {
    const net = fakeNetwork({ failures: [undefined, undefined, { dieAt: 30_000 }, 'ignore-range'] })
    const { store } = makeStore({ net })
    await store.download(ID)
    expect(new Uint8Array(await store.readModel(ID))).toEqual(bytes)
  })

  it('falls back to a plain retry when the resume request itself fails before any byte (CORS, proxies)', async () => {
    const net = fakeNetwork({ failures: [undefined, undefined, { dieAt: 20_000 }, 'throw'] })
    const { store } = makeStore({ net })
    await store.download(ID)
    const modelCalls = net.calls.filter(c => c.url === URLS.model)
    expect(modelCalls.map(c => c.range)).toEqual([undefined, 'bytes=20000-', undefined])
    expect(new Uint8Array(await store.readModel(ID))).toEqual(bytes)
  })

  it('does not retry a 404 and reports it as http', async () => {
    const net = fakeNetwork({ failures: [undefined, undefined, 404] })
    const { store } = makeStore({ net })
    await expect(store.download(ID)).rejects.toMatchObject({ code: 'http', message: expect.stringContaining('404') })
    expect(net.calls.filter(c => c.url === URLS.model).length).toBe(1)
  })

  it('gives up with "offline" after the retries when the network keeps failing', async () => {
    const net = fakeNetwork({ failures: ['throw', 'throw', 'throw', 'throw', 'throw', 'throw', 'throw'] })
    const { store } = makeStore({ net })
    await expect(store.download(ID)).rejects.toMatchObject({ code: 'offline' })
  })

  it('reports "storage" and cleans up when the cache cannot take the file', async () => {
    const { store, caches } = makeStore()
    caches.failPut = Object.assign(new Error('quota'), { name: 'QuotaExceededError' })
    await expect(store.download(ID)).rejects.toMatchObject({ code: 'storage' })
    caches.failPut = null
    expect(await store.has(ID)).toBe(false)
  })

  it('rejects a config that is not JSON', async () => {
    const net = fakeNetwork()
    const real = net.fetch
    net.fetch = async (url, init) => url === URLS.config ? new Response('<html>', { status: 200 }) : real(url, init)
    const { store } = makeStore({ net })
    await expect(store.download(ID)).rejects.toMatchObject({ code: 'http' })
  })
})

describe('VoiceStore storage', () => {
  it('lists only voices that have both files, and removes both', async () => {
    const { store, caches } = makeStore()
    await store.download(ID)
    const cache = await caches.open(CACHE_NAME)
    await cache.put(voiceUrls('en_US-lessac-medium', BASE).model, new Response(new Uint8Array(3)))  // a model without its config
    expect(await store.list()).toEqual(new Set([ID]))
    await store.remove(ID)
    expect(await store.has(ID)).toBe(false)
    expect((await store.list()).size).toBe(0)
  })

  it('ignores cached voices of another base URL (a mirror in tests)', async () => {
    const { store, caches } = makeStore()
    const cache = await caches.open(CACHE_NAME)
    const other = voiceUrls(ID, 'https://elsewhere.test/')
    await cache.put(other.model, new Response(new Uint8Array(3)))
    await cache.put(other.config, new Response('{}'))
    expect((await store.list()).size).toBe(0)
  })

  it('is unsupported (and harmless) without Cache Storage', async () => {
    const store = new VoiceStore({ caches: undefined, fetch: async () => new Response('') })
    expect(store.supported).toBe(false)
    expect((await store.list()).size).toBe(0)
    await expect(store.download(ID)).rejects.toMatchObject({ code: 'storage' })
  })

  it('builds the Hugging Face URLs of the piper-voices layout', () => {
    expect(voiceUrls('es_MX-claude-high').model).toBe('https://huggingface.co/rhasspy/piper-voices/resolve/main/es/es_MX/claude/high/es_MX-claude-high.onnx')
    expect(voiceUrls('ca_ES-upc_ona-medium').config).toBe('https://huggingface.co/rhasspy/piper-voices/resolve/main/ca/ca_ES/upc_ona/medium/ca_ES-upc_ona-medium.onnx.json')
    expect(voiceUrls('en_US-lessac-medium').catalogue).toBe('https://huggingface.co/rhasspy/piper-voices/resolve/main/voices.json')
  })
})
