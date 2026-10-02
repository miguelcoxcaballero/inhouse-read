// Downloaded voices live in Cache Storage ('inhouse-neural-voices-v1'), keyed by the very URL they were fetched from:
// the model (.onnx, ~63 MB) and its config (.onnx.json). The model is written LAST, so "model present" means "voice
// complete"; an interrupted download leaves nothing usable behind (and nothing half-written: Cache.put is atomic).
//
// The download is streamed with progress and is abortable. On flaky mobile data it survives dropped connections: the
// bytes received so far are kept in memory and the transfer continues with a Range request (If-Range with the ETag, so a
// file replaced upstream is never glued together); a server that ignores Range, or a Range request that fails before a
// single byte arrives (CORS, proxies), makes it start again cleanly instead. Sizes are checked against Content-Length and,
// when it can be reached, against the catalogue (voices.json) of the voice repository.
import { neuralVoiceBase, voiceUrls } from './catalog.js'

export const CACHE_NAME = 'inhouse-neural-voices-v1'

/** Error with a `code` the UI maps to Spanish copy: 'offline' | 'http' | 'storage' | 'aborted'. */
export const storeError = (code, message, cause) => Object.assign(new Error(message || code), { code }, cause ? { cause } : {})

const isAbort = error => error?.name === 'AbortError' || error?.code === 'aborted'
const defaultSleep = (ms, signal) => new Promise((resolve, reject) => {
  const timer = setTimeout(resolve, ms)
  signal?.addEventListener('abort', () => { clearTimeout(timer); reject(storeError('aborted', 'aborted')) }, { once: true })
})

export class VoiceStore {
  /**
   * Everything the browser provides is injectable so the logic can be tested without a network or a real cache.
   * @param {{caches?:CacheStorage, fetch?:typeof fetch, base?:()=>string, storage?:StorageManager, sleep?:(ms:number,signal?:AbortSignal)=>Promise<void>, maxRetries?:number, online?:()=>boolean}} deps
   */
  constructor({ caches = globalThis.caches, fetch = globalThis.fetch?.bind(globalThis), base = () => neuralVoiceBase(), storage = globalThis.navigator?.storage, sleep = defaultSleep, maxRetries = 4, online = () => globalThis.navigator?.onLine !== false } = {}) {
    Object.assign(this, { caches, fetchFn: fetch, baseFn: base, storage, sleep, maxRetries, online })
  }

  get supported() { return !!this.caches && typeof this.fetchFn === 'function' }
  urls(piperId) { return voiceUrls(piperId, this.baseFn()) }
  async #cache() {
    try { return await this.caches.open(CACHE_NAME) } catch (error) { throw storeError('storage', 'Cache Storage is not available', error) }
  }

  /** piperIds whose model AND config are both stored. */
  async list() {
    if (!this.supported) return new Set()
    const cache = await this.#cache()
    const have = new Set((await cache.keys()).map(request => request.url))
    const base = this.baseFn()
    const found = new Set()
    for (const url of have) {
      if (!url.startsWith(base) || !url.endsWith('.onnx')) continue
      const piperId = url.slice(url.lastIndexOf('/') + 1, -'.onnx'.length)
      if (have.has(`${url}.json`)) found.add(piperId)
    }
    return found
  }
  async has(piperId) {
    if (!this.supported) return false
    const cache = await this.#cache()
    const { model, config } = this.urls(piperId)
    return !!(await cache.match(model)) && !!(await cache.match(config))
  }
  /** The voice's .onnx.json, parsed. */
  async readConfig(piperId) {
    const response = await (await this.#cache()).match(this.urls(piperId).config)
    if (!response) throw storeError('http', `${piperId} is not downloaded`)
    return response.json()
  }
  /** The model bytes (a fresh ArrayBuffer each time, so it can be transferred to the worker). */
  async readModel(piperId) {
    const response = await (await this.#cache()).match(this.urls(piperId).model)
    if (!response) throw storeError('http', `${piperId} is not downloaded`)
    return response.arrayBuffer()
  }
  async remove(piperId) {
    if (!this.supported) return
    const cache = await this.#cache()
    const { model, config } = this.urls(piperId)
    await cache.delete(model)
    await cache.delete(config)
  }
  /** Asks the browser not to evict the voices under storage pressure. Best effort, never throws. */
  async persist() {
    try { return !!(await this.storage?.persist?.()) } catch { return false }
  }

  /** Size the repository's catalogue promises for the model, or 0 when unknown (offline mirror, slow, or not listed). */
  async expectedSize(piperId, signal) {
    try {
      const { catalogue, key } = this.urls(piperId)
      const response = await this.fetchFn(catalogue, { signal, headers: { accept: 'application/json' } })
      if (!response.ok) return 0
      const list = await response.json()
      return Number(list?.[piperId]?.files?.[key]?.size_bytes) || 0
    } catch (error) {
      if (isAbort(error)) throw storeError('aborted', 'aborted')
      return 0
    }
  }

  /**
   * Downloads a voice into the cache. `onProgress({received,total,fraction})` is called as bytes arrive (total is 0
   * while unknown). Resolves with {bytes}. Rejects with an Error whose `code` is 'offline' | 'http' | 'storage' | 'aborted'.
   */
  async download(piperId, { onProgress = () => {}, signal } = {}) {
    if (!this.supported) throw storeError('storage', 'Cache Storage is not available')
    if (signal?.aborted) throw storeError('aborted', 'aborted')
    if (!this.online()) throw storeError('offline', 'No hay conexión')
    const { model, config } = this.urls(piperId)

    const configResponse = await this.#fetchChecked(config, signal)
    const configText = await configResponse.text()
    try { JSON.parse(configText) } catch (error) { throw storeError('http', `${piperId}: invalid config`, error) }

    const expected = await this.expectedSize(piperId, signal)
    const parts = await this.#fetchBody(model, { signal, expected, onProgress })
    const bytes = parts.reduce((sum, part) => sum + part.length, 0)
    if (expected && bytes !== expected) throw storeError('http', `${piperId}: size ${bytes} instead of ${expected}`)

    await this.persist()
    const cache = await this.#cache()
    try {
      await cache.put(config, new Response(configText, { headers: { 'content-type': 'application/json' } }))
      await cache.put(model, new Response(new Blob(parts, { type: 'application/octet-stream' }), { headers: { 'content-type': 'application/octet-stream', 'content-length': String(bytes) } }))
    } catch (error) {
      await cache.delete(config).catch(() => {})
      await cache.delete(model).catch(() => {})
      throw storeError('storage', 'No hay espacio para guardar la voz', error)
    }
    onProgress({ received: bytes, total: bytes, fraction: 1 })
    return { bytes }
  }

  async #fetchChecked(url, signal, init = {}) {
    let response
    try { response = await this.fetchFn(url, { signal, ...init }) } catch (error) {
      if (isAbort(error) || signal?.aborted) throw storeError('aborted', 'aborted')
      throw storeError('offline', 'No hay conexión', error)
    }
    if (!response.ok) throw storeError('http', `HTTP ${response.status} for ${url}`)
    return response
  }

  /** Streams `url` into memory, riding out connection drops. Returns the received chunks. */
  async #fetchBody(url, { signal, expected, onProgress }) {
    let parts = [], received = 0, total = expected || 0, etag = '', ranged = true
    for (let attempt = 0; ; attempt++) {
      const resume = received > 0 && ranged
      let gotBytes = false
      try {
        const headers = resume ? { range: `bytes=${received}-`, ...(etag ? { 'if-range': etag } : {}) } : {}
        const response = await this.#fetchChecked(url, signal, { headers })
        if (resume && response.status === 206) {
          // The server must continue exactly where we stopped, otherwise we would corrupt the file.
          const start = Number(/bytes (\d+)-/.exec(response.headers.get('content-range') || '')?.[1])
          if (start !== received) throw storeError('http', 'unexpected Content-Range')
        } else {
          parts = []; received = 0 // a plain 200: the whole file again (server ignored Range, or this is the first try)
        }
        etag = response.headers.get('etag') || etag
        const length = Number(response.headers.get('content-length')) || 0
        if (length) total = received + length
        const reader = response.body?.getReader()
        if (!reader) { // no streaming (old WebView): take it in one piece
          const whole = new Uint8Array(await response.arrayBuffer())
          parts.push(whole); received += whole.length; gotBytes = true
          onProgress({ received, total: total || received, fraction: 1 })
        } else {
          for (;;) {
            if (signal?.aborted) { reader.cancel().catch(() => {}); throw storeError('aborted', 'aborted') }
            const { done, value } = await reader.read()
            if (done) break
            parts.push(value); received += value.length; gotBytes = true
            onProgress({ received, total, fraction: total ? Math.min(1, received / total) : 0 })
          }
        }
        if (total && received < total) throw new TypeError('connection closed early') // retried below
        return parts
      } catch (error) {
        if (isAbort(error) || signal?.aborted) throw storeError('aborted', 'aborted', error)
        // Server answers (4xx/5xx...) are final, except a refused range (416): that means "start over".
        if (error.code === 'http' && !/HTTP (416|5\d\d)/.test(error.message)) throw error
        if (resume && !gotBytes) ranged = false // the resume request itself did not work: next time the clean way
        if (/HTTP 416/.test(error.message)) { parts = []; received = 0; ranged = false }
        if (attempt >= this.maxRetries) throw error.code ? error : storeError(this.online() ? 'http' : 'offline', 'La descarga se interrumpió', error)
        await this.sleep(Math.min(8000, 700 * 2 ** attempt), signal)
      }
    }
  }
}
