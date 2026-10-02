// @vitest-environment node
// Regressions found in review of the neural engine: removing the voice in use, a failed worker, outlier chunks,
// a jump while a long segment runs, and cancelling a shared (multi-speaker) download.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { NeuralEngine } from '../../src/js/readers/neural-voice/engine.js'
import { fakeAudioContext, advance, flush, fakeClients, feedJob, recordEvents } from './neural-fakes.js'

const CLAUDE = 'piper:es_MX-claude-high'
const SHARVARD_M = 'piper:es_ES-sharvard-medium', SHARVARD_F = 'piper:es_ES-sharvard-medium#1'

function setup({ installed = [CLAUDE], store: storeOverrides = {} } = {}) {
  vi.useFakeTimers()
  const ctx = fakeAudioContext()
  const env = new EventTarget()
  Object.assign(env, { Worker: function () {}, WebAssembly: {}, AudioContext: function () {}, caches: {} })
  const clients = fakeClients()
  const store = { list: vi.fn(async () => new Set()), download: vi.fn(async () => ({ bytes: 1 })), remove: vi.fn(async () => {}), ...storeOverrides }
  const engine = new NeuralEngine({ store, createClient: clients.createClient, audio: { context: () => ctx, unlock: () => ctx }, env })
  engine._installed = new Set(installed)
  return { ctx, env, clients, store, engine, events: recordEvents(env) }
}
const types = events => events.map(e => `${e.type}:${e.id}${e.reason ? '/' + e.reason : ''}`)

describe('removing the voice that is being read', () => {
  afterEach(() => vi.useRealTimers())

  it("answers the fragment being read with 'not-installed', so the reader moves to another voice instead of waiting for ever", async () => {
    const t = setup()
    t.engine.speak({ text: 'Uno.', voiceId: CLAUDE, id: 'a', upcoming: ['Dos.'] })
    await flush()
    feedJob(t.clients.last().jobs[0], 1)
    advance(t.ctx, 0.1)
    await flush()
    await t.engine.remove(CLAUDE)
    await flush()
    expect(types(t.events)).toEqual(['start:a', 'error:a/not-installed'])
    expect(t.engine.status).toBe('idle')
  })

  it('says nothing when the voice removed is not the one being read, and keeps the worker of the voice that is', async () => {
    const t = setup({ installed: [CLAUDE, 'piper:en_US-lessac-medium'] })
    t.engine.speak({ text: 'Uno.', voiceId: CLAUDE, id: 'a' })
    await flush()
    const client = t.clients.last()
    feedJob(client.jobs[0], 1)
    await t.engine.remove('piper:en_US-lessac-medium')
    await flush()
    expect(types(t.events)).not.toContain('error:a/not-installed')
    expect(client.disposed).toBe(false)
  })

  it('does not tear the worker down under a run that already moved to another voice', async () => {
    const t = setup({ installed: [CLAUDE, 'piper:en_US-lessac-medium'] })
    t.engine.speak({ text: 'Uno.', voiceId: CLAUDE, id: 'a' })
    await flush()
    const client = t.clients.last()
    t.engine.speak({ text: 'Hello.', voiceId: 'piper:en_US-lessac-medium', id: 'b' })
    await flush()
    await t.engine.remove(CLAUDE)
    expect(client.disposed).toBe(false)
  })
})

describe('a worker that failed', () => {
  afterEach(() => vi.useRealTimers())

  it('is dropped and not asked for the fragments behind the failed one; the next speak() starts a fresh worker', async () => {
    const t = setup()
    t.engine.speak({ text: 'Uno.', voiceId: CLAUDE, id: 'a', upcoming: ['Dos.', 'Tres.', 'Cuatro.'] })
    await flush()
    const client = t.clients.last()
    feedJob(client.jobs[0], 2)
    expect(client.jobs.length).toBe(2)
    client.jobs[1].handlers.onError(Object.assign(new Error('RuntimeError'), { code: 'synth-failed' }))
    await flush()
    expect(client.disposed).toBe(true)
    expect(client.jobs.length).toBe(2)                         // 'Tres.' was never sent to the dead worker
    t.engine.speak({ text: 'Cinco.', voiceId: CLAUDE, id: 'b', upcoming: [] })
    await flush()
    expect(t.clients.made.length).toBe(2)                      // a fresh one
    expect(t.clients.last().prepared).toEqual(['es_MX-claude-high'])
  })
})

describe('warm-up during a newer reading', () => {
  afterEach(() => vi.useRealTimers())

  it('does not reject when creating the warm-up client fails', async () => {
    const t = setup()
    t.engine.createClient = () => { throw new Error('worker unavailable') }
    expect(await t.engine.warmUp(CLAUDE)).toBe(false)
  })

  it('does not replace the model of an active run with a different warm-up voice', async () => {
    const other = 'piper:es_ES-davefx-medium', t = setup({ installed:[CLAUDE, other] })
    t.engine.speak({ text:'Uno.', voiceId:CLAUDE, id:'a' }); await flush()
    const client = t.clients.last()
    expect(await t.engine.warmUp(other)).toBe(false)
    expect(client.prepared).toEqual(['es_MX-claude-high'])
    expect(t.engine.run.voice.id).toBe(CLAUDE)
    t.engine.stop()
  })

  it('a failed warm-up from a released worker cannot dispose the newer reading worker', async () => {
    const t = setup()
    const old = t.clients.createClient()
    let failOld
    old.prepare = () => new Promise((resolve, reject) => { failOld = reject })
    t.engine.client = old
    const warming = t.engine.warmUp(CLAUDE)
    t.engine.stop(); vi.advanceTimersByTime(90_000)
    expect(old.disposed).toBe(true)
    t.engine.speak({ text:'Nueva lectura.', voiceId:CLAUDE, id:'new' }); await flush()
    const current = t.clients.last()
    failOld(new Error('old worker was released'))
    expect(await warming).toBe(false)
    expect(current.disposed).toBe(false)
    expect(t.engine.client).toBe(current)
    expect(t.engine.run.voice.id).toBe(CLAUDE)
    t.engine.stop()
  })
})

describe('compute speed samples', () => {
  afterEach(() => vi.useRealTimers())

  it('one stalled chunk (a few seconds of nothing) is not a verdict', async () => {
    const t = setup()
    t.engine.speak({ text: 'F0', voiceId: CLAUDE, id: 'a', upcoming: ['F1', 'F2', 'F3'] })
    await flush()
    const client = t.clients.last()
    ;[800, 800, 800, 2 * 1000 * 6].forEach((ms, i) => feedJob(client.jobs[i], 2, { ms }))   // 0.4 x3, then 6 s of compute for 1 s of speech
    await flush()
    expect(types(t.events)).not.toContain('error:a/too-slow')
    expect(t.engine.stats.tooSlow).toBe(0)
  })

  it('a first chunk that was slow because the worker was waking up is outweighed by the normal ones after it', async () => {
    const t = setup()
    t.engine.speak({ text: 'F0', voiceId: CLAUDE, id: 'a', upcoming: ['F1', 'F2'] })
    await flush()
    const client = t.clients.last()
    feedJob(client.jobs[0], 2, { ms: 2 * 1000 * 4.5 })
    feedJob(client.jobs[1], 2, { ms: 800 })
    feedJob(client.jobs[2], 2, { ms: 800 })
    await flush()
    expect(t.engine.stats.tooSlow).toBe(0)
  })
})

describe('a jump while a long segment is being computed', () => {
  afterEach(() => vi.useRealTimers())

  const startLong = async (idsOfRunningSegment) => {
    const t = setup()
    t.engine.speak({ text: 'Uno.', voiceId: CLAUDE, id: 'a', upcoming: ['Una frase muy larga.'] })
    await flush()
    const client = t.clients.last()
    feedJob(client.jobs[0], 2, { ms: 800 })                    // measured: 0.4 s of compute per second of speech, 30 ids a second
    client.jobs[1].handlers.onPlan([idsOfRunningSegment])      // the long one is being computed
    return { t, client }
  }

  it('rebuilds the worker when waiting for the segment would cost more than a cold start', async () => {
    const { t, client } = await startLong(2000)               // ~2000 x 0.033 s x 0.4 = 27 s of compute left
    t.engine.speak({ text: 'Otra.', voiceId: CLAUDE, id: 'b' })
    await flush()
    expect(client.disposed).toBe(true)
    expect(t.clients.made.length).toBe(2)
    expect(t.clients.last().prepared).toEqual(['es_MX-claude-high'])
  })

  it('keeps the worker when the segment is about to finish anyway', async () => {
    const { t, client } = await startLong(60)                 // ~0.8 s of compute
    t.engine.speak({ text: 'Otra.', voiceId: CLAUDE, id: 'b' })
    await flush()
    expect(client.disposed).toBe(false)
    expect(t.clients.made.length).toBe(1)
  })
})

describe('cancelling a download shared by the speakers of one model', () => {
  afterEach(() => vi.useRealTimers())

  it('cancel(id) of any speaker aborts it, and the install() promises reject as aborted', async () => {
    let seen = null
    const t = setup({ installed: [], store: { download: vi.fn((piperId, { signal }) => new Promise((resolve, reject) => { seen = signal; signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { code: 'aborted' }))) })) } })
    const promise = t.engine.install(SHARVARD_M)
    await flush()
    expect(t.engine.downloads.get(SHARVARD_F)?.state).toBe('downloading')
    t.engine.cancel(SHARVARD_F)                               // the sibling row of the picker, not the one that started it
    expect(seen.aborted).toBe(true)
    await expect(promise).rejects.toMatchObject({ code: 'aborted' })
    expect(t.engine.downloads.size).toBe(0)
  })

  it('the caller\'s own signal still aborts it', async () => {
    let seen = null
    const t = setup({ installed: [], store: { download: vi.fn((piperId, { signal }) => new Promise((resolve, reject) => { seen = signal; signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { code: 'aborted' }))) })) } })
    const controller = new AbortController()
    const promise = t.engine.install(CLAUDE, { signal: controller.signal })
    await flush()
    controller.abort()
    expect(seen.aborted).toBe(true)
    await expect(promise).rejects.toMatchObject({ code: 'aborted' })
  })
})
