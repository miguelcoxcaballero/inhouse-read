// @vitest-environment node
import { describe, it, expect, vi, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { NEURAL_PREFIX, isNeuralVoiceId, neuralVoices, NeuralVoiceEngine, getNeuralEngine, setNeuralEngine } from '../../src/js/readers/neural-voice/index.js'
import { fakeAudioContext, advance, flush, fakeClients, feedJob, recordEvents } from './neural-fakes.js'

const CLAUDE = 'piper:es_MX-claude-high'

describe('the contract (index.js)', () => {
  afterEach(() => vi.useRealTimers())

  it('keeps every export of the contract', () => {
    expect(NEURAL_PREFIX).toBe('piper:')
    expect(isNeuralVoiceId('piper:es_MX-claude-high')).toBe(true)
    expect(isNeuralVoiceId('com.google.tts:es')).toBe(false)
    expect(isNeuralVoiceId(null)).toBe(false)
    expect(neuralVoices.length).toBeGreaterThan(5)
    expect(typeof NeuralVoiceEngine.isSupported).toBe('function')
    const engine = getNeuralEngine()
    expect(getNeuralEngine()).toBe(engine)
    const other = {}
    setNeuralEngine(other)
    expect(getNeuralEngine()).toBe(other)
    setNeuralEngine(null)
  })

  it('every catalogue entry has the contract fields', () => {
    for (const voice of neuralVoices) {
      expect(voice.id).toBe(voice.speaker ? `${NEURAL_PREFIX}${voice.piperId}#${voice.speaker}` : NEURAL_PREFIX + voice.piperId)
      expect(voice).toMatchObject({ lang: expect.stringMatching(/^[a-z]{2}-[A-Z]{2}$/), name: expect.any(String), quality: expect.stringMatching(/^(low|medium|high)$/), sizeMB: expect.any(Number), speaker: expect.any(Number) })
    }
  })

  it('is unsupported (not a crash) where Worker/WebAssembly/Web Audio/Cache Storage are missing', () => {
    expect(NeuralVoiceEngine.isSupported({})).toBe(false)
    expect(NeuralVoiceEngine.isSupported({ Worker() {}, WebAssembly: {}, AudioContext() {}, caches: {} })).toBe(true)
    expect(NeuralVoiceEngine.isSupported({ Worker() {}, WebAssembly: {}, webkitAudioContext() {}, caches: {} })).toBe(true)
    expect(new NeuralVoiceEngine({ env: {} }).supported).toBe(false)
  })

  it('is cheap until used: empty state, no engine code loaded by construction', () => {
    const engine = new NeuralVoiceEngine()
    expect(engine.installed.size).toBe(0)
    expect(engine.downloads.size).toBe(0)
    expect(engine.status).toBe('idle')
    expect(engine.core).toBe(null)
    expect(engine.loading).toBe(null)
  })

  it('does not import the engine, the store, the player or the worker statically (they are lazy chunks)', () => {
    const source = readFileSync(new URL('../../src/js/readers/neural-voice/index.js', import.meta.url), 'utf8')
    const staticImports = [...source.matchAll(/^import .* from '([^']+)'/gm)].map(m => m[1])
    expect(staticImports.sort()).toEqual(['./audio.js', './catalog.js'])
    expect(source).toMatch(/import\('\.\/engine\.js'\)/)
    for (const file of ['catalog.js', 'audio.js']) {
      const text = readFileSync(new URL(`../../src/js/readers/neural-voice/${file}`, import.meta.url), 'utf8')
      expect([...text.matchAll(/^import .* from '([^']+)'/gm)]).toEqual([])
    }
  })

  it('loads the engine on first use: speak() before it is ready is delivered, in order, once it is', async () => {
    vi.useFakeTimers()
    const ctx = fakeAudioContext()
    const env = new EventTarget()
    Object.assign(env, { Worker() {}, WebAssembly: {}, AudioContext() {}, caches: {} })
    const clients = fakeClients()
    const store = { list: vi.fn(async () => new Set(['es_MX-claude-high'])), download: vi.fn(), remove: vi.fn() }
    const engine = new NeuralVoiceEngine({ store, createClient: clients.createClient, audio: { context: () => ctx, unlock: () => ctx }, env })
    const events = recordEvents(env)
    const changes = vi.fn()
    engine.addEventListener('change', changes)
    await engine.refresh()
    expect(engine.installed).toEqual(new Set([CLAUDE]))
    expect(changes).toHaveBeenCalledTimes(1)

    // a second engine whose code is not loaded yet
    const lazy = new NeuralVoiceEngine({ store, createClient: clients.createClient, audio: { context: () => ctx, unlock: () => ctx }, env })
    lazy.speak({ text: 'Uno.', voiceId: CLAUDE, id: 'a' })        // not installed in 'lazy' (never refreshed)...
    await vi.dynamicImportSettled?.()
    await flush(); await flush()
    expect(events.at(-1)).toMatchObject({ type: 'error', id: 'a', reason: 'not-installed' })

    engine.speak({ text: 'Uno.', voiceId: CLAUDE, id: 'b' })
    await flush()
    feedJob(clients.last().jobs[0], 1)
    advance(ctx, 0.1)
    await flush()
    expect(events.map(e => `${e.type}:${e.id}`).slice(-1)).toEqual(['start:b'])
    expect(engine.status).toBe('speaking')
    engine.stop()
    expect(engine.status).toBe('idle')
  })

  it('stop() before the engine is loaded drops the pending speak()', async () => {
    const env = new EventTarget()
    const engine = new NeuralVoiceEngine({ env, store: { list: async () => new Set(['es_MX-claude-high']) }, audio: { context: () => null, unlock: () => null } })
    const events = recordEvents(env)
    engine.speak({ text: 'Uno.', voiceId: CLAUDE, id: 'a' })
    engine.stop()
    await engine.preload()
    await flush()
    expect(events).toEqual([])
  })
})
