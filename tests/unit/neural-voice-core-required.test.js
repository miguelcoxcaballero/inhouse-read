// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'

// The rules of the voice, the cleaning of the audio and the tempo have no JavaScript implementation any more: the synthesis
// worker and the Android client wait for the voice core next to onnxruntime-web (no serial wait is added), and a core that cannot
// load is a clear error for the person, never a silent fallback.
const mocks = vi.hoisted(() => ({ phonemizer: vi.fn() }))
vi.mock('../../src/js/readers/neural-voice/phonemizer.js', () => ({ createPhonemizer: mocks.phonemizer }))

describe('the synthesis worker without its voice core', () => {
  let messages, scope
  beforeEach(() => {
    vi.resetModules(); messages = []
    mocks.phonemizer.mockReset().mockResolvedValue({ phonemize: vi.fn() })
    scope = { postMessage: message => messages.push(message) }
    vi.stubGlobal('self', scope)
  })
  afterEach(() => vi.unstubAllGlobals())
  const init = () => scope.onmessage({ data: { type: 'init', id: 1, ortBase: pathToFileURL(resolve('tests/unit/fixtures/neural-ort') + '/').href, phonBase: 'https://test/phon/' } })

  it('reports the failed load as the answer to init, in the app\'s words', async () => {
    await import('../../src/js/readers/neural-voice/worker.js')
    globalThis.__inhouseVoiceReady = Promise.resolve(null)
    await init()
    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({ type: 'error', id: 1 })
    expect(messages[0].error).toMatch(/módulo de voz no se pudo cargar/)
  })

  it('answers init with ready when the core loads, as before', async () => {
    await import('../../src/js/readers/neural-voice/worker.js')
    await init()
    expect(messages.map(message => message.type)).toEqual(['ready'])
  })
})

describe('the Android client without its voice core', () => {
  it('rejects the preparation of a voice instead of continuing without the rules', async () => {
    vi.resetModules()
    vi.doMock('../../src/js/rust-voice-core.js', () => ({ getRustVoiceCore: () => null, requireRustVoiceCore: () => Promise.reject(new Error('El módulo de voz no se pudo cargar. Recarga la página.')), loadedRustVoiceCore: () => { throw new Error('not loaded') } }))
    const { NativeSynthClient } = await import('../../src/js/readers/neural-voice/native-client.js')
    const ort = { dispose() {}, InferenceSession: { create: async () => ({ inputNames: [], outputNames: [], release: async () => {} }) } }
    const client = new NativeSynthClient({
      store: { readConfig: async () => ({ audio: { sample_rate: 22050 }, espeak: { voice: 'es' }, num_symbols: 256 }), readModel: async () => new ArrayBuffer(8) },
      createOrt: () => ort, createPhon: async () => ({ phonemize: async () => [1, 0, 2], destroy() {} })
    })
    await expect(client.prepare('es_ES-davefx-medium')).rejects.toThrow(/módulo de voz/)
    client.dispose()
    vi.doUnmock('../../src/js/rust-voice-core.js')
  })
})
