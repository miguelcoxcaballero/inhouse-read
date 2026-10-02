// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NeuralEngine } from '../../src/js/readers/neural-voice/engine.js'
import { advance, fakeAudioContext, fakeClients, feedJob, flush, recordEvents } from './neural-fakes.js'

const DANIELA = 'piper:es_AR-daniela-high', CLAUDE = 'piper:es_MX-claude-high'
let engine, ctx, clients, events
beforeEach(() => {
  vi.useFakeTimers()
  ctx = fakeAudioContext(); clients = fakeClients()
  const env = new EventTarget()
  engine = new NeuralEngine({ env, createClient:clients.createClient, audio:{ context:() => ctx, unlock:() => ctx }, store:{} })
  engine._installed = new Set([DANIELA, CLAUDE]); events = recordEvents(env)
})
afterEach(() => { engine.stop(); vi.useRealTimers() })
const chunk = (job, index, last = false) => job.handlers.onChunk({ index, last, pcm:new Float32Array(22050).fill(.2), sampleRate:22050, ms:2000 })

describe('natural voices that compute slower than real time', () => {
  it.each([1, 1.25])('buffers valid Daniela segments at rate %s instead of aborting before first audio', async rate => {
    engine.speak({ text:'La biblioteca permanecía abierta hasta la noche.', voiceId:DANIELA, rate, id:'argentina' })
    await flush()
    const job = clients.last().jobs[0]
    expect(job.request).toMatchObject({ speaker:0, rate })
    job.handlers.onPlan([30, 30, 30, 30])
    for (let index = 0; index < 3; index++) chunk(job, index)
    await flush()
    expect(engine.run).not.toBeNull()
    expect(events.filter(event => event.type === 'error')).toEqual([])
    expect(engine.status).toBe('buffering')
    expect(ctx.sources).toHaveLength(0)
    chunk(job, 3, true); job.handlers.onEnd()
    expect(ctx.sources).toHaveLength(4)
    advance(ctx, 4.2); await flush()
    expect(events).toEqual([{ type:'start', id:'argentina' }, { type:'done', id:'argentina' }])
    expect(ctx.sources.every(source => !source.stopped)).toBe(true)
  })

  it('keeps the same voice after repeated underruns and finishes subsequent fragments', async () => {
    engine.speak({ text:'F0', voiceId:DANIELA, id:'id0', upcoming:['F1', 'F2', 'F3', 'F4'] })
    await flush()
    const client = clients.last(); feedJob(client.jobs[0], 1, { ms:100 })
    for (let index = 1; index <= 4; index++) {
      advance(ctx, 3); feedJob(client.jobs[index], 1, { ms:100 }); await flush()
      engine.speak({ text:`F${index}`, voiceId:DANIELA, id:`id${index}`, upcoming:index < 4 ? [`F${index + 1}`] : [] })
    }
    advance(ctx, 2); await flush()
    expect(engine.stats.underruns).toBeGreaterThanOrEqual(3)
    expect(events.filter(event => event.type === 'error')).toEqual([])
    expect(events).toContainEqual({ type:'done', id:'id4' })
    expect(client.prepared).toEqual(['es_AR-daniela-high'])
  })

  it('cancels buffered synthesis without playing late chunks', async () => {
    engine.speak({ text:'Argentina.', voiceId:DANIELA, id:'a' }); await flush()
    const job = clients.last().jobs[0]; job.handlers.onPlan([30, 30, 30, 30])
    for (let index = 0; index < 3; index++) chunk(job, index)
    engine.stop(); chunk(job, 3, true); job.handlers.onEnd()
    advance(ctx, 10); await flush()
    expect(job.cancelled).toBe(true)
    expect(ctx.sources).toHaveLength(0)
    expect(events).toEqual([])
  })

  it('does not carry a slow voice policy into another selected natural voice', async () => {
    engine.speak({ text:'Argentina.', voiceId:DANIELA, id:'a' }); await flush()
    const job = clients.last().jobs[0]; job.handlers.onPlan([30, 30, 30, 30])
    for (let index = 0; index < 3; index++) chunk(job, index)
    engine.speak({ text:'México.', voiceId:CLAUDE, id:'b' }); await flush()
    feedJob(clients.last().jobs.at(-1), 1)
    advance(ctx, 1.2); await flush()
    expect(events).toEqual([{ type:'start', id:'b' }, { type:'done', id:'b' }])
  })
})
