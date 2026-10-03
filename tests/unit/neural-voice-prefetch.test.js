// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NeuralEngine } from '../../src/js/readers/neural-voice/engine.js'
import { fakeAudioContext, fakeClients, advance, flush, feedJob, recordEvents } from './neural-fakes.js'
const VOICE = 'piper:es_MX-claude-high'
let engine, ctx, clients, events
beforeEach(() => {
  vi.useFakeTimers(); ctx = fakeAudioContext(); clients = fakeClients()
  const env = new EventTarget()
  engine = new NeuralEngine({ env, store:{}, createClient:clients.createClient,
    audio:{ context:() => ctx, unlock:() => ctx } })
  engine._installed.add(VOICE); events = recordEvents(env)
})
afterEach(() => { engine.stop(); vi.clearAllTimers(); vi.useRealTimers() })
async function current(upcoming = [], deferAfter = Infinity) {
  engine.speak({ text:'Página uno.', voiceId:VOICE, id:'first', upcoming, deferAfter })
  await flush(); feedJob(clients.last().jobs[0], 3)
  advance(ctx, .1); await flush()
}

describe('bounded deferred PCM for the next page', () => {
  it('computes and caches next-page PCM during current audio but never schedules it before adoption', async () => {
    await current()
    expect(engine.extendUpcoming({ id:'first', voiceId:VOICE, upcoming:['Página dos.'], deferAfter:0 })).toBe(true)
    const client = clients.last(); feedJob(client.jobs[1], 2)
    expect(engine.cache.size).toBe(2)
    expect(ctx.sources).toHaveLength(1)
    advance(ctx, 3.1); await flush()
    expect(events.map(event => event.id)).toEqual(['first','first'])
    expect(ctx.sources).toHaveLength(1)
    engine.speak({ text:'Página dos.', voiceId:VOICE, id:'second' })
    await flush()
    expect(client.jobs).toHaveLength(2)
    expect(engine.stats.prefetchHits).toBe(1)
    expect(ctx.sources).toHaveLength(2)
    expect(events.filter(event => event.id === 'second')).toEqual([])
    advance(ctx, .1); await flush()
    expect(events.at(-1)).toMatchObject({ type:'start', id:'second' })
  })
  it('keeps ordinary fragments gapless while stopping at the deferred page boundary', async () => {
    await current(['Otro fragmento.', 'Página dos.'], 1)
    const client = clients.last()
    feedJob(client.jobs[1], 2); feedJob(client.jobs[2], 2)
    expect(ctx.sources).toHaveLength(2)
    expect(ctx.sources[1].startedAt).toBeCloseTo(ctx.sources[0].startedAt + 3)
    engine.speak({ text:'Otro fragmento.', voiceId:VOICE, id:'middle', upcoming:['Página dos.'], deferAfter:0 })
    expect(ctx.sources).toHaveLength(2)
    advance(ctx, 5.2); await flush()
    expect(events.some(event => event.id === 'second')).toBe(false)
    expect(ctx.sources).toHaveLength(2)
  })
  it('rejects late IDs, another voice and another rate without restarting active audio', async () => {
    await current()
    for (const options of [{ id:'old', voiceId:VOICE }, { id:'first', voiceId:'missing' }, { id:'first', voiceId:VOICE, rate:1.25 }]) {
      expect(engine.extendUpcoming({ ...options, upcoming:['Wrong page.'], deferAfter:0 })).toBe(false)
    }
    expect(clients.last().jobs).toHaveLength(1)
    expect(ctx.sources[0].stopped).toBe(false)
    expect(events.filter(event => event.type === 'start')).toHaveLength(1)
  })
  it('cancels deferred synthesis and ignores its late chunks on Stop', async () => {
    await current(['Página dos.'], 0)
    const job = clients.last().jobs[1]
    engine.stop(); feedJob(job, 2); advance(ctx, 4); await flush()
    expect(job.cancelled).toBe(true)
    expect(ctx.sources).toHaveLength(1)
    expect(events.filter(event => event.type === 'done')).toEqual([])
  })
  it('discards prefetched audio on a speed change and never plays it under the new ID', async () => {
    await current(['Página dos.'], 0)
    const client = clients.last(); feedJob(client.jobs[1], 2)
    engine.speak({ text:'Página uno.', voiceId:VOICE, rate:1.25, id:'changed' })
    await flush()
    expect(client.jobs.at(-1).request).toMatchObject({ text:'Página uno.', rate:1.25 })
    expect(ctx.sources).toHaveLength(1)
    expect(ctx.sources[0].stopped).toBe(true)
    expect(engine.stats.prefetchHits).toBe(0)
  })
  it('bounds the future queue and does not replay start when updating upcoming PCM', async () => {
    await current()
    engine.extendUpcoming({ id:'first', voiceId:VOICE, upcoming:Array.from({ length:30 }, (_, i) => `Future ${i}.`), deferAfter:0 })
    await flush()
    expect(engine.run.entries).toHaveLength(engine.limits.maxUpcoming + 1)
    expect(engine.run.entries.slice(1).every(entry => entry.deferred)).toBe(true)
    expect(events.filter(event => event.type === 'start')).toHaveLength(1)
    expect(ctx.sources).toHaveLength(1)
  })
})
