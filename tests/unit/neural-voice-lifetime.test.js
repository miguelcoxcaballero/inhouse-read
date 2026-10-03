// @vitest-environment node
// An elapsed wall-clock duration must not turn an active audiobook into idle
// work. Use short PCM arrays and a manual audio clock; no real model is loaded.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LIMITS, NeuralEngine } from '../../src/js/readers/neural-voice/engine.js'
import { advance, fakeAudioContext, fakeClients, feedJob, flush, recordEvents } from './neural-fakes.js'

const VOICE = 'piper:es_MX-claude-high'
let ctx, clients, engine, env, events
beforeEach(() => {
  vi.useFakeTimers()
  ctx = fakeAudioContext(); clients = fakeClients(); env = new EventTarget()
  Object.assign(env, { Worker: function () {}, WebAssembly: {}, AudioContext: function () {}, caches: {} })
  engine = new NeuralEngine({ env, createClient:clients.createClient, audio:{ context:() => ctx, unlock:() => ctx }, store:{}, limits:{ lruEntries:3, lruSamples:4_500 } })
  engine._installed = new Set([VOICE]); events = recordEvents(env)
})
afterEach(() => { engine.stop(); vi.clearAllTimers(); vi.useRealTimers() })

describe('the neural worker lifetime during a long audiobook', () => {
  it('adopts 26 consecutive fragments for over six minutes without idle teardown or losing a terminal event', async () => {
    const texts = Array.from({ length:26 }, (_, i) => `Fragmento ${i + 1}.`)
    const speak = index => engine.speak({ text:texts[index], voiceId:VOICE, id:`fragment-${index}`, upcoming:texts.slice(index + 1, index + 3) })
    let next = 1
    env.addEventListener('inhouse-tts', event => {
      if (event.detail.type === 'done' && next < texts.length) speak(next++)
    })
    await engine.warmUp(VOICE) // arms the idle timer; the first speak must cancel it
    speak(0); await flush()
    const client = clients.last()
    let fed = 0
    const feedQueued = () => {
      while (fed < client.jobs.length) feedJob(client.jobs[fed++], 15, { sampleRate:100 })
    }
    feedQueued()
    for (let index = 0; index < texts.length; index++) {
      advance(ctx, 15.1); await flush(); feedQueued(); await flush()
      expect(client.disposed).toBe(false)
      expect(engine.cache.size).toBeLessThanOrEqual(3)
      expect(engine.cache.samples).toBeLessThanOrEqual(4_500)
    }
    expect(ctx.currentTime).toBeGreaterThan(6 * 60)
    expect(clients.made).toHaveLength(1)
    expect(events.filter(event => event.type === 'start').map(event => event.id)).toEqual(texts.map((_, i) => `fragment-${i}`))
    expect(events.filter(event => event.type === 'done').map(event => event.id)).toEqual(texts.map((_, i) => `fragment-${i}`))
    expect(events.filter(event => ['error', 'interrupted'].includes(event.type))).toEqual([])
    expect(engine.status).toBe('idle')
    advance(ctx, LIMITS.idleMs / 1000 + 1)
    expect(client.disposed).toBe(true) // release still happens after real inactivity
  })

  it('keeps a pending synthesis alive past six minutes and starts/finishes it when PCM arrives', async () => {
    await engine.warmUp(VOICE)
    engine.speak({ text:'Un fragmento que aún se está calculando.', voiceId:VOICE, id:'pending' })
    await flush()
    const client = clients.last(), job = client.jobs[0]
    vi.advanceTimersByTime(6 * 60_000 + 1)
    expect(client.disposed).toBe(false)
    expect(job.cancelled).toBe(false)
    expect(engine.run).not.toBeNull()
    expect(events).toEqual([])
    feedJob(job, 1, { sampleRate:100 })
    advance(ctx, 1.2); await flush()
    expect(events).toEqual([{ type:'start', id:'pending' }, { type:'done', id:'pending' }])
  })
})
