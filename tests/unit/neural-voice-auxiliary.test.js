// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { VoiceStore, CACHE_NAME } from '../../src/js/readers/neural-voice/store.js'
import { voiceUrls } from '../../src/js/readers/neural-voice/catalog.js'
import { fakeCaches } from './neural-fakes.js'
import { fetchDictionary } from '../../src/js/readers/neural-voice/dictionary-cache.js'

const ID = 'he_IL-saspeech-medium', BASE = 'https://mirror.test/voices/'
const model = Uint8Array.of(9, 8, 7, 6), aux = Uint8Array.of(1, 2, 3)
const hash = createHash('sha256').update(aux).digest('hex')
function setup({ badHash = false, interrupt = false } = {}) {
  const caches = fakeCaches(), controller = new AbortController(), requests = [], writes = []
  const urls = { ...voiceUrls(ID, BASE), phonemizerSize:aux.length, phonemizerSha256:badHash ? '0'.repeat(64) : hash }
  const config = { phoneme_type:'hebrew', audio:{ sample_rate:22050 } }
  const fetch = async url => {
    requests.push(url)
    if (url === urls.config) return Response.json(config)
    if (url === urls.catalogue) return Response.json({ [ID]:{ files:{ [urls.key]:{ size_bytes:model.length } } } })
    if (url === urls.phonemizerModel && interrupt) controller.abort()
    const bytes = url === urls.phonemizerModel ? aux : model
    return new Response(bytes, { headers:{ 'content-length':String(bytes.length) } })
  }
  const store = new VoiceStore({ caches, fetch, base:() => BASE, sleep:async () => {}, online:() => true })
  const original = store.urls.bind(store)
  store.urls = id => id === ID ? urls : original(id)
  const opened = caches.open.bind(caches)
  caches.open = async name => {
    const cache = await opened(name), put = cache.put.bind(cache)
    cache.put = async (url, response) => { writes.push(url); return put(url, response) }
    return cache
  }
  return { store, caches, controller, urls, requests, writes }
}

describe('complete Hebrew voice installation', () => {
  it('installs an external espeak dictionary before the voice marker, then serves it offline', async () => {
    const id = 'bg_BG-dimitar-medium', urls = voiceUrls(id, BASE), caches = fakeCaches()
    const dictionary = readFileSync('public/neural-voice/phon/dict/bg_dict')
    const dictionaryBase = 'https://app.test/neural-voice/phon/'
    const progress = [], calls = []
    const fetch = async url => {
      calls.push(url)
      if (url === urls.config) return Response.json({ phoneme_type:'espeak', espeak:{ voice:'bg' } })
      if (url === urls.catalogue) return Response.json({ [id]:{ files:{ [urls.key]:{ size_bytes:model.length } } } })
      const bytes = url.endsWith('bg_dict') ? dictionary : model
      return new Response(bytes, { headers:{ 'content-length':String(bytes.length) } })
    }
    const store = new VoiceStore({ caches, fetch, base:() => BASE, dictionaryBase:() => dictionaryBase, online:() => true })
    expect((await store.download(id, { onProgress:p => progress.push(p) })).bytes).toBe(model.length + dictionary.length)
    expect(calls).toContain(`${dictionaryBase}dict/bg_dict`)
    expect(progress.map(p => p.fraction)).toEqual(progress.map(p => p.fraction).sort((a,b) => a-b))
    expect(progress.at(-1).fraction).toBe(1)
    expect(await store.has(id)).toBe(true)
    const cached = await fetchDictionary(`${dictionaryBase}dict/bg_dict`, { caches, fetch:() => { throw new Error('offline') } })
    expect(new Uint8Array(await cached.arrayBuffer())).toEqual(new Uint8Array(dictionary))
  })

  it('downloads and validates both models before marking the voice installed, with continuous progress', async () => {
    const { store, urls, requests, writes } = setup(), progress = []
    expect(await store.download(ID, { onProgress:p => progress.push(p) })).toEqual({ bytes:7 })
    expect(requests).toContain(urls.phonemizerModel)
    expect(writes).toEqual([urls.config, urls.phonemizerModel, urls.model])
    expect(progress.at(-1)).toEqual({ received:7, total:7, fraction:1 })
    expect(progress.map(p => p.fraction)).toEqual(progress.map(p => p.fraction).sort((a,b) => a-b))
    expect(await store.has(ID)).toBe(true)
    expect(await store.list()).toContain(ID)
    store.online = () => false
    expect(new Uint8Array(await store.readPhonemizerModel(ID))).toEqual(aux)
    expect(new Uint8Array(await store.readModel(ID))).toEqual(model)
    await store.remove(ID)
    expect(await store.has(ID)).toBe(false)
    await expect(store.readPhonemizerModel(ID)).rejects.toMatchObject({ code:'http' })
  })
  it('rejects a missing auxiliary even if model and config were previously cached', async () => {
    const { store, caches, urls } = setup()
    const cache = await caches.open(CACHE_NAME)
    await cache.put(urls.config, Response.json({ phoneme_type:'hebrew' }))
    await cache.put(urls.model, new Response(model))
    expect(await store.has(ID)).toBe(false)
    expect(await store.list()).not.toContain(ID)
  })
  it('never commits weights with the wrong auxiliary checksum', async () => {
    const { store, writes } = setup({ badHash:true })
    await expect(store.download(ID)).rejects.toMatchObject({ code:'http' })
    expect(writes).toEqual([])
    expect(await store.has(ID)).toBe(false)
  })
  it('cancels between models without leaving a partial installed voice', async () => {
    const { store, controller, writes } = setup({ interrupt:true })
    await expect(store.download(ID, { signal:controller.signal })).rejects.toMatchObject({ code:'aborted' })
    expect(writes).toEqual([])
    expect(await store.has(ID)).toBe(false)
  })
  it('cleans all resources after a storage failure', async () => {
    const { store, caches } = setup()
    caches.failPut = new Error('quota')
    await expect(store.download(ID)).rejects.toMatchObject({ code:'storage' })
    expect(await store.has(ID)).toBe(false)
    expect(await store.list()).not.toContain(ID)
  })
  it('discovers pinned author models and Unicode filenames after reloading the store', async () => {
    const { store, caches } = setup()
    store.baseFn = () => 'https://huggingface.co/rhasspy/piper-voices/resolve/main/'
    const cache = await caches.open(CACHE_NAME)
    for (const id of ['sr_RS-marko-medium', 'pt_PT-tugão-medium']) {
      const urls = voiceUrls(id)
      await cache.put(new Request(urls.model), new Response(model))
      await cache.put(new Request(urls.config), Response.json({}))
      expect(await store.has(id)).toBe(true)
    }
    expect(await store.list()).toEqual(new Set(['sr_RS-marko-medium', 'pt_PT-tugão-medium']))
  })
})
