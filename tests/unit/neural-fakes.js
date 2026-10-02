// Fakes shared by the neural-voice unit tests: an AudioContext with a manual clock, a CacheStorage, a fetch with scripted
// behaviour, and a synthesis client (the worker) the test drives by hand. Nothing here is a test.
import { vi } from 'vitest'

/** AudioContext whose clock only moves when advance() is called (with fake timers, so the player's timers fire too). */
export function fakeAudioContext({ outputLatency = 0, state = 'running' } = {}) {
  const ctx = new EventTarget()
  Object.assign(ctx, { currentTime: 0, state, outputLatency, baseLatency: 0, destination: {}, sources: [], buffers: [] })
  ctx.createBuffer = (channels, length, sampleRate) => {
    const buffer = { length, sampleRate, duration: length / sampleRate, data: null, copyToChannel(data) { this.data = data } }
    ctx.buffers.push(buffer)
    return buffer
  }
  ctx.createBufferSource = () => {
    const source = { buffer: null, onended: null, startedAt: null, stopped: false, connect() {}, disconnect() {}, start(when) { this.startedAt = when; ctx.sources.push(this) }, stop() { this.stopped = true } }
    return source
  }
  ctx.resume = async () => { ctx.state = 'running' }
  ctx.setState = next => { ctx.state = next; ctx.dispatchEvent(new Event('statechange')) }
  return ctx
}

/** Moves the audio clock and the (fake) timers forward together, in 10 ms steps. */
export function advance(ctx, seconds) {
  const steps = Math.round(seconds * 100)
  for (let i = 0; i < steps; i++) { ctx.currentTime += 0.01; vi.advanceTimersByTime(10) }
}
export const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve() }

/** A synthesis client the test controls: prepare() resolves at once, every synth() is recorded as a job to feed by hand. */
export function fakeClients() {
  const made = []
  const createClient = () => {
    const client = {
      loaded: null, disposed: false, prepared: [], jobs: [], failPrepare: null,
      async prepare(piperId) { client.prepared.push(piperId); if (client.failPrepare) throw client.failPrepare; client.loaded = piperId },
      synth(request, handlers) {
        const job = { request, handlers, cancelled: false, cancel() { job.cancelled = true } }
        client.jobs.push(job)
        return job
      },
      dispose() { client.disposed = true }
    }
    made.push(client)
    return client
  }
  return { createClient, made, last: () => made.at(-1) }
}

/** Feeds a job: a plan of `counts` ids per sentence, then one chunk per entry of `seconds` (the last one flagged). */
export function feedJob(job, seconds, { sampleRate = 22050, ms, counts } = {}) {
  const list = Array.isArray(seconds) ? seconds : [seconds]
  job.handlers.onPlan?.(counts || list.map(s => Math.round(s * 30)))
  list.forEach((s, index) => {
    const pcm = new Float32Array(Math.round(s * sampleRate)).fill(0.2)
    job.handlers.onChunk({ index, last: index === list.length - 1, pcm, sampleRate, ms: ms ?? s * 1000 * 0.4 })
  })
  job.handlers.onEnd()
}

/** Listens to the window-style 'inhouse-tts' events on `env`. */
export function recordEvents(env) {
  const events = []
  env.addEventListener('inhouse-tts', event => events.push(event.detail))
  return events
}

/** A Cache Storage in memory. `failPut` makes put() throw (a full disk). */
export function fakeCaches() {
  const stores = new Map()
  const api = {
    failPut: null,
    stores,
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map())
      const map = stores.get(name)
      return {
        async put(request, response) {
          if (api.failPut) throw api.failPut
          const url = typeof request === 'string' ? request : request.url
          map.set(url, new Uint8Array(await response.arrayBuffer()))
          map.set(`headers:${url}`, response.headers.get('content-type'))
        },
        async match(request) {
          const url = typeof request === 'string' ? request : request.url
          const body = map.get(url)
          return body ? new Response(body.slice(), { headers: { 'content-type': map.get(`headers:${url}`) || '' } }) : undefined
        },
        async keys() { return [...map.keys()].filter(key => !key.startsWith('headers:')).map(url => ({ url })) },
        async delete(request) { const url = typeof request === 'string' ? request : request.url; map.delete(`headers:${url}`); return map.delete(url) }
      }
    }
  }
  return api
}
