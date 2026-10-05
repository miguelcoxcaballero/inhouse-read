// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NeuralEngine } from '../../src/js/readers/neural-voice/engine.js'
import { NeuralVoiceEngine } from '../../src/js/readers/neural-voice/index.js'
import { fakeAudioContext, fakeClients, flush } from './neural-fakes.js'

const VOICE = 'piper:es_MX-claude-high'
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
function setup(createClient) {
  vi.useFakeTimers()
  const env = new EventTarget(), ctx = fakeAudioContext(), clients = fakeClients()
  Object.assign(env, { Worker() {}, WebAssembly:{}, AudioContext() {}, caches:{} })
  const engine = new NeuralEngine({ env, store:{ list:async () => new Set() },
    createClient:createClient || clients.createClient, audio:{ context:() => ctx, unlock:() => ctx } })
  engine._installed = new Set([VOICE])
  return { env, engine, clients }
}
afterEach(() => vi.useRealTimers())

describe('explicit reader-close inference release', () => {
  it('synchronously releases the loaded client and PCM cache without rearming an idle timer', async () => {
    const t = setup()
    await t.engine.warmUp(VOICE)
    t.engine.cache.put('pcm', [{ pcm:new Float32Array(64), sampleRate:22050 }])
    const client = t.clients.last()
    expect(t.engine.release()).toBeUndefined()
    expect(client.disposed).toBe(true)
    expect(t.engine.client).toBeNull()
    expect(t.engine.run).toBeNull()
    expect(t.engine.cache.samples).toBe(0)
    expect(t.engine.idleTimer).toBeNull()
    t.engine.release()
    expect(t.clients.made).toHaveLength(1)
  })

  it('invalidates a pending client and does not arm idle when its old preparation settles', async () => {
    const pending = deferred(), client = { prepare:() => pending.promise, dispose:vi.fn() }
    const t = setup(() => client)
    const warm = t.engine.warmUp(VOICE)
    t.engine.release()
    expect(client.dispose).toHaveBeenCalledOnce()
    pending.resolve()
    expect(await warm).toBe(false)
    expect(t.engine.client).toBeNull()
    expect(t.engine.idleTimer).toBeNull()
  })

  it('lets rapid reopen own a fresh client while an obsolete warm promise settles', async () => {
    const pending = deferred(), old = { prepare:() => pending.promise, dispose:vi.fn() }
    const fresh = { prepare:async () => {}, dispose:vi.fn() }
    let made = 0
    const t = setup(() => ++made === 1 ? old : fresh)
    const first = t.engine.warmUp(VOICE)
    t.engine.release()
    expect(await t.engine.warmUp(VOICE)).toBe(true)
    pending.resolve()
    expect(await first).toBe(false)
    expect(t.engine.client).toBe(fresh)
    expect(fresh.dispose).not.toHaveBeenCalled()
    t.engine.release()
  })

  it('does not release a running hidden audiobook or change ordinary stop policy', async () => {
    const t = setup()
    t.engine.speak({ text:'Audio continues.', voiceId:VOICE, id:'reading' })
    await flush()
    const client = t.clients.last()
    t.env.dispatchEvent(new Event('visibilitychange'))
    expect(t.engine.run).not.toBeNull()
    expect(client.disposed).toBe(false)
    t.engine.stop()
    expect(client.disposed).toBe(false)
    expect(t.engine.idleTimer).not.toBeNull()
    t.engine.release()
  })

  it('does not preload a missing core on explicit release', () => {
    const engine = new NeuralVoiceEngine(), preload = vi.spyOn(engine, 'preload')
    engine.queue.push(() => {})
    expect(engine.release()).toBeUndefined()
    expect(engine.queue).toHaveLength(0)
    expect(preload).not.toHaveBeenCalled()
    expect(engine.core).toBeNull()
  })

  it('blocks facade warmUp after release during its asynchronous module preload', async () => {
    const pending = deferred(), engine = new NeuralVoiceEngine(), core = { warmUp:vi.fn() }
    vi.spyOn(engine, 'preload').mockReturnValue(pending.promise)
    const warm = engine.warmUp(VOICE)
    engine.release()
    pending.resolve(core)
    expect(await warm).toBe(false)
    expect(core.warmUp).not.toHaveBeenCalled()
  })
})
