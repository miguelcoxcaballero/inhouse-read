// @vitest-environment node
import './helpers/rust-ui-ready.js'
import { describe, it, expect } from 'vitest'
import { webcrypto } from 'node:crypto'
import { VoiceStore, voiceUrls } from '../../src/js/readers/neural-voice/store.js'
import { SupertonicStore } from '../../src/js/readers/neural-voice/supertonic-store.js'
import { LegacyVoiceStore, LegacySupertonicStore } from './helpers/reference-voice-stores.js'
import { fakeCaches } from './neural-fakes.js'

// The one-line members of the Piper and Supertonic voice stores are answered by one rust-ui dispatcher (store_methods.rs) instead of
// being JavaScript methods that each called an export. The frozen classes keep those methods: every member must give
// the same answer, the same failure and the same calls on the stores behind it.
const pairs = [[VoiceStore, LegacyVoiceStore], [SupertonicStore, LegacySupertonicStore]]
const plain = async value => {
  value = await value
  if (value instanceof Set) return { set:[...value] }
  if (value instanceof ArrayBuffer) return { bytes:[...new Uint8Array(value)] }
  if (value && typeof value === 'object' && !Array.isArray(value) && Object.values(value).some(entry => entry instanceof ArrayBuffer)) {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, entry instanceof ArrayBuffer ? [...new Uint8Array(entry)] : entry]))
  }
  return value
}
const outcome = async run => {
  try { return { value:await plain(run()) } } catch (error) { return { error:String(error?.message), code:error?.code, type:error?.constructor?.name } }
}

describe('voice store members answered by the Rust dispatcher', () => {
  it('keeps the shape of class members', () => {
    for (const [Now, Before] of pairs) {
      expect(Object.getOwnPropertyNames(Now.prototype).sort()).toEqual(Object.getOwnPropertyNames(Before.prototype).sort())
      for (const name of Object.getOwnPropertyNames(Before.prototype)) {
        const now = Object.getOwnPropertyDescriptor(Now.prototype, name), before = Object.getOwnPropertyDescriptor(Before.prototype, name)
        expect({ name, enumerable:now.enumerable, configurable:now.configurable, writable:now.writable, get:typeof now.get, value:typeof now.value })
          .toEqual({ name, enumerable:before.enumerable, configurable:before.configurable, writable:before.writable, get:typeof before.get, value:typeof before.value })
      }
      expect(Object.keys(new Now({ caches:null, fetch:null }))).toEqual(Object.keys(new Before({ caches:null, fetch:null })))
    }
  })

  it('answers every Supertonic member like the frozen store through an installation', async () => {
    const content = { 'onnx/duration_predictor.onnx':'test-model', 'onnx/tts.json':'{"test":true}', 'onnx/unicode_indexer.json':'[0,1]', 'voice_styles/F1.json':'{"voice":1}', 'LICENSE':'license' }
    const assets = await Promise.all(Object.entries(content).map(async ([path, text]) => {
      const bytes = new TextEncoder().encode(text), hash = await webcrypto.subtle.digest('SHA-256', bytes)
      return { path, bytes:bytes.byteLength, sha256:Buffer.from(hash).toString('hex') }
    }))
    const logs = []
    for (const Store of [SupertonicStore, LegacySupertonicStore]) {
      const map = new Map(), log = []
      const cache = { match:async key => map.get(key)?.clone(), put:async (key, response) => { map.set(key, new Response(await response.arrayBuffer(), { headers:response.headers })) },
        delete:async key => map.delete(key), keys:async () => [...map.keys()].map(url => ({ url })) }
      const store = new Store({ caches:{ open:async () => cache, delete:async () => { map.clear(); return true } }, fetch:async url => new Response(content[url.replace('https://fixture/', '')]),
        crypto:webcrypto, storage:{ persist:async () => true }, base:'https://fixture/', assets })
      const step = async (name, run) => log.push([name, await outcome(run)])
      const members = async () => {
        await step('installed', () => store.installed()); await step('availableStyles', () => store.availableStyles())
        await step('committedAssets', () => store.committedAssets()); await step('readConfig', () => store.readConfig()); await step('readAssets', () => store.readAssets())
      }
      expect(await store.cache()).toBe(cache)
      await members()
      await step('install', () => store.install().then(() => 'installed'))
      await members()
      await step('remove', () => store.remove())
      await members()
      log.push(['stored', [...map.keys()].sort()])
      logs.push(log)
    }
    expect(logs[0]).toEqual(logs[1])
    expect(logs[0].find(([name]) => name === 'install')[1]).toEqual({ value:'installed' })
  })

  it('answers every Piper member like the frozen store before and after a download', async () => {
    const BASE = 'https://mirror.test/voices/', ID = 'es_MX-claude-high', urls = voiceUrls(ID, BASE)
    const body = Uint8Array.from({ length:30_000 }, (_, i) => i % 251), config = { audio:{ sample_rate:22050 }, num_speakers:1 }
    const logs = []
    for (const Store of [VoiceStore, LegacyVoiceStore]) {
      const log = [], requests = []
      const fetch = async (url, init = {}) => {
        requests.push([url, init.headers?.range])
        if (url === urls.catalogue) return Response.json({ [ID]:{ files:{ [urls.key]:{ size_bytes:body.length } } } })
        if (url === urls.config) return new Response(JSON.stringify(config), { headers:{ 'content-type':'application/json' } })
        return new Response(body, { status:200, headers:{ 'content-length':String(body.length), etag:'"v1"' } })
      }
      const store = new Store({ caches:fakeCaches(), fetch, base:() => BASE, storage:{ persist:async () => true }, sleep:async () => {}, online:() => true })
      const step = async (name, run) => log.push([name, await outcome(run)])
      const members = async () => {
        await step('list', () => store.list()); await step('has', () => store.has(ID)); await step('has other', () => store.has('en_US-none-low'))
        await step('readConfig', () => store.readConfig(ID)); await step('readModel', () => store.readModel(ID).then(buffer => buffer.byteLength))
        await step('readPhonemizerModel', () => store.readPhonemizerModel(ID)); await step('expectedSize', () => store.expectedSize(ID))
        await step('persist', () => store.persist())
      }
      expect(store.supported).toBe(true)
      await members()
      const progress = []
      await step('download', () => store.download(ID, { onProgress:state => progress.push(state.received) }))
      log.push(['progress', progress.at(-1)])
      await members()
      await step('remove', () => store.remove(ID))
      await members()
      await step('download aborted', () => { const controller = new AbortController(); controller.abort(); return store.download(ID, { signal:controller.signal }) })
      log.push(['requests', requests])
      logs.push(log)
    }
    expect(logs[0]).toEqual(logs[1])
    expect(logs[0].find(([name]) => name === 'download')[1].value).toMatchObject({ bytes:30_000 })
  })

  it('fails like a method for a member the dispatcher does not know', async () => {
    const { rustUI } = await import('./helpers/rust-ui-ready.js')
    expect(() => rustUI.store_method({}, 'nope', [], { part:'piper' }, rustUI)).toThrow(TypeError)
  })
})
