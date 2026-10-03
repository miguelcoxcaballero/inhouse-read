// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NeuralEngine, FragmentCache, LIMITS } from '../../src/js/readers/neural-voice/engine.js'
import { neuralVoices } from '../../src/js/readers/neural-voice/catalog.js'
import { fakeAudioContext, advance, flush, fakeClients, feedJob, recordEvents } from './neural-fakes.js'

const CLAUDE = 'piper:es_MX-claude-high'
const SHARVARD_M = 'piper:es_ES-sharvard-medium', SHARVARD_F = 'piper:es_ES-sharvard-medium#1'

function setup({ installed = [CLAUDE], store: storeOverrides = {}, limits = {} } = {}) {
  vi.useFakeTimers()
  const ctx = fakeAudioContext()
  const env = new EventTarget()
  Object.assign(env, { Worker: function () {}, WebAssembly: {}, AudioContext: function () {}, caches: {} })
  const clients = fakeClients()
  const store = {
    list: vi.fn(async () => new Set(installed.map(id => id.slice('piper:'.length).replace(/#\d+$/, '')))),
    download: vi.fn(async () => ({ bytes: 1 })),
    remove: vi.fn(async () => {}),
    ...storeOverrides
  }
  const engine = new NeuralEngine({ store, createClient: clients.createClient, audio: { context: () => ctx, unlock: () => ctx }, env, limits })
  engine._installed = new Set(installed)
  const events = recordEvents(env)
  return { ctx, env, clients, store, engine, events }
}
const types = events => events.map(e => `${e.type}:${e.id}${e.reason ? '/' + e.reason : ''}`)

describe('NeuralEngine reading aloud', () => {
  let t
  beforeEach(() => { t = setup() })
  afterEach(() => vi.useRealTimers())

  it('prepares the worker with the voice, synthesises the text and reports start/done at the audible times', async () => {
    t.engine.speak({ text: 'Hola mundo.', voiceId: CLAUDE, rate: 1.25, id: 'a' })
    await flush()
    const client = t.clients.last()
    expect(client.prepared).toEqual(['es_MX-claude-high'])
    expect(client.jobs.length).toBe(1)
    expect(client.jobs[0].request).toEqual({ text: 'Hola mundo.', rate: 1.25, speaker: 0 })
    expect(t.engine.status).toBe('buffering')
    feedJob(client.jobs[0], 2)
    expect(t.ctx.sources.length).toBe(1)
    await flush()
    expect(types(t.events)).toEqual([])               // scheduled, not yet audible
    advance(t.ctx, 0.1)
    await flush()
    expect(types(t.events)).toEqual(['start:a'])
    expect(t.engine.status).toBe('speaking')
    advance(t.ctx, 2)
    await flush()
    expect(types(t.events)).toEqual(['start:a', 'done:a'])
    expect(t.engine.status).toBe('idle')
    expect(t.engine.stats.firstAudioMs).toBeGreaterThan(0)
  })

  it('is gapless: the next fragment is synthesised while this one plays and speak(next) adopts it', async () => {
    t.engine.speak({ text: 'Uno.', voiceId: CLAUDE, id: 'a', upcoming: ['Dos.', 'Tres.'] })
    await flush()
    const client = t.clients.last()
    feedJob(client.jobs[0], 2)
    // one synth at a time, in reading order, started as soon as the first finished
    expect(client.jobs.map(j => j.request.text)).toEqual(['Uno.', 'Dos.'])
    feedJob(client.jobs[1], 2)
    expect(client.jobs.map(j => j.request.text)).toEqual(['Uno.', 'Dos.', 'Tres.'])
    feedJob(client.jobs[2], 1)
    const starts = t.ctx.sources.map(s => s.startedAt)
    expect(starts[1]).toBeCloseTo(starts[0] + 2, 3)    // back to back on the audio clock
    expect(starts[2]).toBeCloseTo(starts[1] + 2, 3)
    advance(t.ctx, 2.1)
    await flush()
    expect(types(t.events)).toEqual(['start:a', 'done:a'])
    // the reader reacts to 'done' like reading-voice.js does
    t.engine.speak({ text: 'Dos.', voiceId: CLAUDE, id: 'b', upcoming: ['Tres.'] })
    await flush()
    expect(client.jobs.length).toBe(3)                 // nothing re-synthesised
    expect(t.ctx.sources.every(s => !s.stopped)).toBe(true)
    expect(types(t.events)).toEqual(['start:a', 'done:a', 'start:b'])  // 'Dos.' was already audible: reported at once, not re-started
    advance(t.ctx, 2)
    await flush()
    expect(types(t.events).slice(-1)).toEqual(['done:b'])
  })

  it('reports an adopted fragment that had not started yet when it does', async () => {
    t.engine.speak({ text: 'Uno.', voiceId: CLAUDE, id: 'a', upcoming: ['Dos.'] })
    await flush()
    const client = t.clients.last()
    feedJob(client.jobs[0], 2); feedJob(client.jobs[1], 2)
    t.engine.speak({ text: 'Dos.', voiceId: CLAUDE, id: 'b', upcoming: [] })  // asked early (the reader skipped ahead)
    await flush()
    advance(t.ctx, 0.1)
    await flush()
    expect(types(t.events)).toContain('start:a')
    expect(types(t.events)).not.toContain('start:b')
    advance(t.ctx, 2)
    await flush()
    expect(types(t.events)).toContain('start:b')
  })

  it('restarts cleanly when the text, voice or rate is not the one it prepared', async () => {
    t.engine.speak({ text: 'Uno.', voiceId: CLAUDE, id: 'a', upcoming: ['Dos.'] })
    await flush()
    const client = t.clients.last()
    feedJob(client.jobs[0], 2)
    const dos = client.jobs[1]
    t.engine.speak({ text: 'Otra cosa.', voiceId: CLAUDE, id: 'b', upcoming: [] })
    await flush()
    expect(dos.cancelled).toBe(true)
    expect(t.ctx.sources[0].stopped).toBe(true)
    expect(client.jobs.at(-1).request.text).toBe('Otra cosa.')
    feedJob(client.jobs.at(-1), 1)
    advance(t.ctx, 0.2)
    await flush()
    expect(types(t.events)).toEqual(['start:b'])      // nothing for the replaced id
    // a different rate is a different run: the cached audio of 'Uno.' is for rate 1
    t.engine.speak({ text: 'Otra cosa.', voiceId: CLAUDE, rate: 1.5, id: 'c', upcoming: [] })
    await flush()
    expect(client.jobs.at(-1).request).toEqual({ text: 'Otra cosa.', rate: 1.5, speaker: 0 })
  })

  it('keeps going when the reader asks for the same next fragments but drops the ones that changed', async () => {
    t.engine.speak({ text: 'Uno.', voiceId: CLAUDE, id: 'a', upcoming: ['Dos.', 'Tres.'] })
    await flush()
    const client = t.clients.last()
    feedJob(client.jobs[0], 1); feedJob(client.jobs[1], 1); feedJob(client.jobs[2], 1)
    expect(t.ctx.sources.length).toBe(3)
    advance(t.ctx, 1.1)
    await flush()
    t.engine.speak({ text: 'Dos.', voiceId: CLAUDE, id: 'b', upcoming: ['Cambiada.'] })
    await flush()
    expect(t.ctx.sources.filter(s => s.stopped).length).toBe(1) // 'Tres.' was queued after 'Dos.': dropped
    expect(client.jobs.at(-1).request.text).toBe('Cambiada.')
  })

  it('stop() cancels the synthesis, silences the audio and fires nothing for the cancelled id', async () => {
    t.engine.speak({ text: 'Uno.', voiceId: CLAUDE, id: 'a', upcoming: ['Dos.'] })
    await flush()
    const client = t.clients.last()
    feedJob(client.jobs[0], 3)
    advance(t.ctx, 0.1)
    await flush()
    t.engine.stop()
    expect(client.jobs[1].cancelled).toBe(true)
    expect(t.ctx.sources.every(s => s.stopped)).toBe(true)
    expect(t.engine.status).toBe('idle')
    const before = types(t.events)
    advance(t.ctx, 10)
    await flush()
    expect(types(t.events)).toEqual(before)
    expect(before).toEqual(['start:a'])
  })

  it('replays a fragment it already synthesised from memory without the worker', async () => {
    t.engine.speak({ text: 'Uno.', voiceId: CLAUDE, id: 'a' })
    await flush()
    const client = t.clients.last()
    feedJob(client.jobs[0], 2)
    t.engine.stop()
    t.engine.speak({ text: 'Uno.', voiceId: CLAUDE, id: 'b' })
    await flush()
    expect(client.jobs.length).toBe(1)
    expect(t.engine.stats.cacheHits).toBe(1)
    advance(t.ctx, 0.1)
    await flush()
    expect(types(t.events)).toEqual(['start:a', 'start:b'].slice(1))  // 'a' was stopped before it began
  })

  it('does not even start the worker when everything asked for is already in memory', async () => {
    t.engine.speak({ text: 'Uno.', voiceId: CLAUDE, id: 'a' })
    await flush()
    feedJob(t.clients.last().jobs[0], 1)
    t.engine.stop()
    t.engine.teardownForTest?.()
    const made = t.clients.made.length
    t.engine.client = null
    t.engine.speak({ text: 'Uno.', voiceId: CLAUDE, id: 'b' })
    await flush()
    expect(t.clients.made.length).toBe(made)
  })

  it('synthesises ahead only as far as the look-ahead allows', async () => {
    t.engine.speak({ text: 'F0', voiceId: CLAUDE, id: 'a', upcoming: Array.from({ length: 6 }, (_, i) => `F${i + 1}`) })
    await flush()
    const client = t.clients.last()
    for (let i = 0; i < 3; i++) feedJob(client.jobs[i], 10)   // 3 fragments of 10 s: 30 s of audio is waiting
    expect(client.jobs.length).toBe(3)                         // no fourth job yet: >= 30 s buffered
    advance(t.ctx, 0.5)                                        // a little of F0 is gone: below 30 s again
    await flush()
    expect(client.jobs.length).toBe(4)
    feedJob(client.jobs[3], 10)
    expect(client.jobs.length).toBe(4)                         // 40 s waiting again
  })

  it('never has more than maxAhead fragments ahead of the one playing', async () => {
    t = setup({ limits: { lookaheadSec: 1000, maxAhead: 3 } })
    t.engine.speak({ text: 'F0', voiceId: CLAUDE, id: 'a', upcoming: ['F1', 'F2', 'F3', 'F4', 'F5'] })
    await flush()
    const client = t.clients.last()
    for (let i = 0; i < 3; i++) feedJob(client.jobs[i], 1)
    expect(client.jobs.length).toBe(3)
  })

  it('waits in silence for a stalled voice (buffering, never garbage) and counts the underrun', async () => {
    t.engine.speak({ text: 'Uno.', voiceId: CLAUDE, id: 'a', upcoming: ['Dos.'] })
    await flush()
    const client = t.clients.last()
    feedJob(client.jobs[0], 1)
    advance(t.ctx, 3)                                          // the first fragment is over and the second is not ready
    await flush()
    expect(types(t.events)).toEqual(['start:a', 'done:a'])
    expect(t.ctx.sources.length).toBe(1)                       // nothing scheduled: silence
    feedJob(client.jobs[1], 2)
    expect(t.engine.stats.underruns).toBe(1)
    t.engine.speak({ text: 'Dos.', voiceId: CLAUDE, id: 'b' })
    advance(t.ctx, 0.2)
    await flush()
    expect(types(t.events)).toContain('start:b')
  })

  it('keeps the selected voice and buffers complete fragments after repeated underruns', async () => {
    t.engine.speak({ text: 'F0', voiceId: CLAUDE, id: 'id0', upcoming: ['F1', 'F2', 'F3', 'F4'] })
    await flush()
    const client = t.clients.last()
    feedJob(client.jobs[0], 1, { ms: 100 })
    for (let k = 1; k <= 3; k++) {
      advance(t.ctx, 3)                                        // it plays out and nothing new is ready
      feedJob(client.jobs[k], 1, { ms: 100 })                  // a late chunk: underrun k
      await flush()
      if (k < 3) t.engine.speak({ text: `F${k}`, voiceId: CLAUDE, id: `id${k}`, upcoming: [`F${k + 1}`, `F${k + 2}`].filter(x => x !== 'F5') })
    }
    await flush()
    expect(t.engine.stats.underruns).toBe(3)
    expect(t.engine.stats.tooSlow).toBe(1)
    expect(t.events.some(event => event.type === 'error')).toBe(false)
    expect(t.engine.run.buffered).toBe(true)
    expect(t.engine.run.voice.id).toBe(CLAUDE)
    expect(t.engine.currentId).toBe('id2')
  })

  it('forgives the underruns of a page that was read to its end (a short heading before a long sentence), but not of a restart in mid-page', async () => {
    t.engine.speak({ text: 'Uno.', voiceId: CLAUDE, id: 'a', upcoming: ['Dos.'] })
    await flush()
    const client = t.clients.last()
    feedJob(client.jobs[0], 1)
    advance(t.ctx, 3)                                          // the heading is over, the long sentence is still being computed
    await flush()
    feedJob(client.jobs[1], 2)                                 // late: an underrun
    expect(t.engine.stats.underruns).toBe(1)
    expect(t.engine.underrunTimes.length).toBe(1)
    t.engine.speak({ text: 'Dos.', voiceId: CLAUDE, id: 'b' })
    advance(t.ctx, 2.5)
    await flush()
    expect(types(t.events)).toContain('done:b')                // the page was read to its end
    t.engine.speak({ text: 'Tres.', voiceId: CLAUDE, id: 'c', upcoming: ['Cuatro.'] }) // the next page
    await flush()
    expect(t.engine.underrunTimes).toEqual([])                 // forgiven
    expect(t.engine.stats.underruns).toBe(1)                   // but still counted for the diagnostics
    t.engine.underrunTimes = [0, 1]
    t.engine.speak({ text: 'Otra.', voiceId: CLAUDE, id: 'd' }) // a jump in mid-page: its record stays
    await flush()
    expect(t.engine.underrunTimes).toEqual([0, 1])
  })

  it('buffers without aborting when compute is far slower than real time', async () => {
    t.engine.speak({ text: 'Uno.', voiceId: CLAUDE, id: 'a', upcoming: ['Dos.', 'Tres.', 'Cuatro.'] })
    await flush()
    const client = t.clients.last()
    for (let i = 0; i < 3; i++) feedJob(client.jobs[i], 2, { ms: 2 * 1000 * 2.5 })  // 2.5 s of compute per second of speech
    await flush()
    expect(t.events.some(event => event.type === 'error')).toBe(false)
    expect(t.engine.run.buffered).toBe(true)
    expect(t.engine.run.voice.id).toBe(CLAUDE)
    expect(t.engine.currentId).toBe('a')
    expect(t.engine.stats.tooSlow).toBe(1)
  })

  it('forgives underruns after a clean stretch of fragments', async () => {
    t.engine.underrunTimes = [0, 1]
    t.engine.speak({ text: 'F0', voiceId: CLAUDE, id: 'a', upcoming: Array.from({ length: LIMITS.cleanFragments }, (_, i) => `G${i}`) })
    await flush()
    const client = t.clients.last()
    for (let i = 0; i < 6; i++) { if (client.jobs[i]) feedJob(client.jobs[i], 1) }
    advance(t.ctx, 12)
    for (let i = 6; i < 9; i++) { if (client.jobs[i]) feedJob(client.jobs[i], 1) }
    advance(t.ctx, 12)
    await flush()
    expect(t.engine.underrunTimes).toEqual([])
  })

  it('holds the first chunk back when starting at once would stall mid-fragment, but never longer than maxHold', async () => {
    t.engine.speak({ text: 'Corta. Y una larga.', voiceId: CLAUDE, id: 'a' })
    await flush()
    const job = t.clients.last().jobs[0]
    job.handlers.onPlan([20, 400])
    const pcm = n => new Float32Array(n * 22050).fill(0.1)
    job.handlers.onChunk({ index: 0, last: false, pcm: pcm(1), sampleRate: 22050, ms: 700 })   // 1 s of speech took 0.7 s...
    expect(t.ctx.sources.length).toBe(0)                       // ...and the next one is predicted ~20 s: too risky, wait
    expect(t.engine.status).toBe('buffering')
    vi.advanceTimersByTime(LIMITS.maxHoldMs + 100)
    expect(t.ctx.sources.length).toBe(1)                       // it speaks anyway after maxHold
  })

  it('starts at once when the rest of the fragment is predicted to arrive in time', async () => {
    t.engine.speak({ text: 'Primera frase. Segunda frase.', voiceId: CLAUDE, id: 'a' })
    await flush()
    const job = t.clients.last().jobs[0]
    job.handlers.onPlan([100, 100])
    job.handlers.onChunk({ index: 0, last: false, pcm: new Float32Array(3 * 22050).fill(0.1), sampleRate: 22050, ms: 1200 })
    expect(t.ctx.sources.length).toBe(1)
  })

  it('is interrupted (not stopped) when the system takes the audio away', async () => {
    t.engine.speak({ text: 'Uno.', voiceId: CLAUDE, id: 'a', upcoming: ['Dos.'] })
    await flush()
    const client = t.clients.last()
    feedJob(client.jobs[0], 3)
    advance(t.ctx, 0.1)
    await flush()
    t.ctx.setState('suspended')
    await flush()
    expect(types(t.events)).toEqual(['start:a', 'interrupted:a'])
    expect(t.ctx.sources.every(s => s.stopped)).toBe(true)
    expect(t.engine.status).toBe('idle')
  })

  it('reports not-installed for a voice that is not downloaded, and unknown ids', async () => {
    t.engine.speak({ text: 'x', voiceId: 'piper:de_DE-thorsten-medium', id: 'a' })
    t.engine.speak({ text: 'x', voiceId: 'piper:nope', id: 'b' })
    await flush()
    expect(types(t.events)).toEqual(['error:a/not-installed', 'error:b/not-installed'])
  })

  it("reports 'init-failed' when the worker or the model cannot start, and tries again next time", async () => {
    const first = t.clients
    t.engine.createClient = () => { const c = first.createClient(); c.failPrepare = new Error('wasm'); return c }
    t.engine.speak({ text: 'Uno.', voiceId: CLAUDE, id: 'a' })
    await flush()
    expect(types(t.events)).toEqual(['error:a/init-failed'])
    expect(first.made[0].disposed).toBe(true)
    expect(t.engine.status).toBe('idle')
    t.engine.createClient = first.createClient
    t.engine.speak({ text: 'Uno.', voiceId: CLAUDE, id: 'b' })
    await flush()
    expect(first.made.at(-1).jobs.length).toBe(1)
  })

  it("reports 'synth-failed' for the fragment being read and defers a lookahead failure to when it is asked for", async () => {
    t.engine.speak({ text: 'Uno.', voiceId: CLAUDE, id: 'a', upcoming: ['Dos.'] })
    await flush()
    const client = t.clients.last()
    feedJob(client.jobs[0], 1)
    client.jobs[1].handlers.onError(Object.assign(new Error('onnx'), { code: 'synth-failed' }))
    await flush()
    expect(types(t.events)).toEqual([])                       // 'Uno.' still plays
    advance(t.ctx, 1.2)
    await flush()
    expect(types(t.events)).toEqual(['start:a', 'done:a'])
    t.engine.speak({ text: 'Dos.', voiceId: CLAUDE, id: 'b' })
    await flush()
    expect(types(t.events).at(-1)).toBe('error:b/synth-failed')
  })

  it('frees the worker after an idle spell and rebuilds it for the next speak', async () => {
    t.engine.speak({ text: 'Uno.', voiceId: CLAUDE, id: 'a' })
    await flush()
    const client = t.clients.last()
    feedJob(client.jobs[0], 1)
    advance(t.ctx, 1.2)
    await flush()
    expect(client.disposed).toBe(false)
    advance(t.ctx, (LIMITS.idleMs - 2000) / 1000)
    expect(client.disposed).toBe(false)
    advance(t.ctx, 3)
    expect(client.disposed).toBe(true)
    t.engine.speak({ text: 'Dos.', voiceId: CLAUDE, id: 'b' })
    await flush()
    expect(t.clients.made.length).toBe(2)
    expect(t.clients.last().jobs.length).toBe(1)
  })

  it('does not free the worker while it is speaking, and speak() cancels a pending teardown', async () => {
    t.engine.speak({ text: 'Larga.', voiceId: CLAUDE, id: 'a' })
    await flush()
    const client = t.clients.last()
    feedJob(client.jobs[0], 200)                               // 200 s of audio: far longer than the idle limit
    advance(t.ctx, 100)
    expect(client.disposed).toBe(false)
    t.engine.stop()
    advance(t.ctx, 60)
    t.engine.speak({ text: 'Otra.', voiceId: CLAUDE, id: 'b' })
    advance(t.ctx, 60)
    expect(client.disposed).toBe(false)
  })

  it('warmUp prepares the worker and model without speaking', async () => {
    expect(await t.engine.warmUp(CLAUDE)).toBe(true)
    expect(t.clients.last().prepared).toEqual(['es_MX-claude-high'])
    expect(t.clients.last().jobs).toEqual([])
    expect(await t.engine.warmUp('piper:de_DE-thorsten-medium')).toBe(false)
  })

  it('uses the speaker of a multi-speaker model', async () => {
    t = setup({ installed: [SHARVARD_M, SHARVARD_F] })
    t.engine.speak({ text: 'Hola.', voiceId: SHARVARD_F, id: 'a' })
    await flush()
    expect(t.clients.last().prepared).toEqual(['es_ES-sharvard-medium'])
    expect(t.clients.last().jobs[0].request.speaker).toBe(1)
  })
})

describe('NeuralEngine downloads', () => {
  afterEach(() => vi.useRealTimers())

  it('publishes progress, then marks every speaker of the model installed', async () => {
    const t = setup({ installed: [] })
    let release
    t.store.download = vi.fn(async (piperId, { onProgress }) => {
      onProgress({ received: 10, total: 100, fraction: 0.1 })
      vi.advanceTimersByTime(500)
      onProgress({ received: 60, total: 100, fraction: 0.6 })
      await new Promise(resolve => { release = resolve })
      return { bytes: 100 }
    })
    const changes = []
    t.engine.addEventListener('change', () => changes.push([...t.engine.downloads.entries()].map(([id, d]) => `${id}=${d.state}:${d.fraction}`)))
    const promise = t.engine.install(SHARVARD_F)
    await flush()
    expect(t.engine.downloads.get(SHARVARD_M)).toMatchObject({ state: 'downloading', fraction: 0.6 })
    expect(t.engine.downloads.get(SHARVARD_F)).toBe(t.engine.downloads.get(SHARVARD_M))  // the speakers share one download
    expect(changes.length).toBeGreaterThanOrEqual(2)
    release()
    await promise
    expect(t.engine.installed).toEqual(new Set([SHARVARD_M, SHARVARD_F]))
    expect(t.engine.downloads.size).toBe(0)
    expect(t.store.download.mock.calls[0][0]).toBe('es_ES-sharvard-medium')
  })

  it('a second install() of the same model joins the running one', async () => {
    const t = setup({ installed: [] })
    let release
    t.store.download = vi.fn(() => new Promise(resolve => { release = () => resolve({ bytes: 1 }) }))
    const a = t.engine.install(CLAUDE), b = t.engine.install(CLAUDE)
    await flush()
    release()
    await Promise.all([a, b])
    expect(t.store.download).toHaveBeenCalledTimes(1)
  })

  it('keeps a failed download visible (with its code) and removes an aborted one', async () => {
    const t = setup({ installed: [] })
    t.store.download = vi.fn(async () => { throw Object.assign(new Error('No hay conexión'), { code: 'offline' }) })
    await expect(t.engine.install(CLAUDE)).rejects.toMatchObject({ code: 'offline' })
    expect(t.engine.downloads.get(CLAUDE)).toMatchObject({ state: 'error', code: 'offline', error: 'No hay conexión' })
    expect(t.engine.installed.size).toBe(0)
    t.store.download = vi.fn(async () => { throw Object.assign(new Error('aborted'), { code: 'aborted' }) })
    await expect(t.engine.install(CLAUDE, { signal: new AbortController().signal })).rejects.toMatchObject({ code: 'aborted' })
    expect(t.engine.downloads.size).toBe(0)
  })

  it('rejects unknown voices as unsupported and does nothing for an installed one', async () => {
    const t = setup({ installed: [CLAUDE] })
    await expect(t.engine.install('piper:nope')).rejects.toMatchObject({ code: 'unsupported' })
    await t.engine.install(CLAUDE)
    expect(t.store.download).not.toHaveBeenCalled()
  })

  it('refresh() reads Cache Storage and fires change only when something differs', async () => {
    const t = setup({ installed: [CLAUDE] })
    t.engine._installed = new Set()
    const changes = vi.fn()
    t.engine.addEventListener('change', changes)
    await t.engine.refresh()
    expect(t.engine.installed).toEqual(new Set([CLAUDE]))
    await t.engine.refresh()
    expect(changes).toHaveBeenCalledTimes(1)
  })

  it('refresh() reports all speakers of a stored model', async () => {
    const t = setup({ installed: [SHARVARD_M] })
    t.engine._installed = new Set()
    await t.engine.refresh()
    expect(t.engine.installed).toEqual(new Set([SHARVARD_M, SHARVARD_F]))
  })

  it('refresh exposes only the legacy profiles actually committed offline', async () => {
    const old = 'supertonic3:F1:es', added = 'supertonic3:F3:es'
    const t = setup({ installed:[], store:{listVoices:vi.fn(async () => new Set([old]))} })
    await t.engine.refresh()
    expect(t.store.listVoices).toHaveBeenCalledWith(neuralVoices)
    expect(t.engine.installed.has(old)).toBe(true)
    expect(t.engine.installed.has(added)).toBe(false)
    expect(t.store.list).not.toHaveBeenCalled()
  })

  it('selecting a newly installed profile replaces an old three-style worker before synthesis', async () => {
    const added = 'supertonic3:F3:es', t = setup({installed:[added]})
    const old = t.clients.createClient()
    old.loaded = 'supertonic3'; old.config = {runtime:'supertonic3',styles:{F1:{},M1:{},F2:{}}}
    t.engine.client = old
    t.engine.speak({text:'Hola.',voiceId:added,id:'new-profile'})
    await flush()
    expect(old.disposed).toBe(true)
    expect(t.clients.last()).not.toBe(old)
    expect(t.clients.last().prepared).toEqual(['supertonic3'])
    expect(t.clients.last().jobs[0].request).toMatchObject({style:'F3',lang:'es',text:'Hola.'})
  })

  it('expanding a pack preserves playback and the active legacy worker until a new profile is selected', async () => {
    const oldId = 'supertonic3:F1:es', added = 'supertonic3:F3:es', t = setup({installed:[oldId]})
    t.engine.speak({text:'Hola.',voiceId:oldId,id:'old-profile'})
    await flush()
    const old = t.clients.last(); old.config={runtime:'supertonic3',styles:{F1:{},M1:{},F2:{}}}
    feedJob(old.jobs[0],5)
    advance(t.ctx,.1); await flush()
    await t.engine.install(added)
    expect(old.disposed).toBe(false)
    expect(t.engine.client).toBe(old)
    expect(t.ctx.sources.every(source=>!source.stopped)).toBe(true)
    expect(t.engine.installed.has(added)).toBe(true)
    expect(types(t.events)).toEqual(['start:old-profile'])
  })

  it('remove() stops a voice that is speaking, deletes it and forgets its cached audio', async () => {
    const t = setup({ installed: [CLAUDE] })
    t.engine.speak({ text: 'Uno.', voiceId: CLAUDE, id: 'a' })
    await flush()
    const client = t.clients.last()
    feedJob(client.jobs[0], 1)
    await t.engine.remove(CLAUDE)
    expect(t.store.remove).toHaveBeenCalledWith('es_MX-claude-high')
    expect(t.engine.installed.size).toBe(0)
    expect(client.disposed).toBe(true)
    expect(t.engine.cache.size).toBe(0)
    expect(t.ctx.sources.every(s => s.stopped)).toBe(true)
  })
})

describe('FragmentCache', () => {
  const entry = n => [{ pcm: new Float32Array(n) }]
  it('drops the least recently used entry beyond its entry and sample budgets', () => {
    const cache = new FragmentCache(2, 100)
    cache.put('a', entry(10)); cache.put('b', entry(10))
    cache.get('a')
    cache.put('c', entry(10))
    expect(cache.get('b')).toBe(null)
    expect(cache.get('a')).not.toBe(null)
    cache.put('d', entry(95))
    expect(cache.size).toBe(1)
    cache.put('huge', entry(500))
    expect(cache.get('huge')).toBe(null)
  })
})

describe('catalogue', () => {
  it('has every curated voice once, one entry per speaker, a recommended default per language', () => {
    const ids = neuralVoices.map(v => v.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(neuralVoices.filter(voice => voice.runtime !== 'supertonic3')).toHaveLength(39)
    expect(neuralVoices.filter(voice => voice.runtime === 'supertonic3')).toHaveLength(220)
    expect(neuralVoices.filter(v => v.piperId === 'es_ES-sharvard-medium').map(v => [v.id, v.speaker])).toEqual([[SHARVARD_M, 0], [SHARVARD_F, 1]])
    const languages = [...new Set(neuralVoices.map(v => v.lang.split('-')[0]))]
    expect(languages).toEqual(['es', 'en', 'fr', 'de', 'it', 'pt', 'ca', 'nl', 'pl', 'ru', 'uk', 'tr', 'sv', 'da', 'nb', 'fi', 'cs', 'el', 'hu', 'ro', 'ar', 'zh', 'vi', 'bg', 'sr', 'hi', 'he'])
    for (const language of languages) expect(neuralVoices.filter(v => v.lang.startsWith(language + '-') && v.recommended).length).toBe(1)
    expect(neuralVoices.find(v => v.piperId === 'es_MX-claude-high').quality).toBe('high')
  })
})
