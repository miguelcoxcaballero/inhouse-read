import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Where voices are downloaded from is read once at start-up and must be https (or this machine): a book's own script runs
// with the page's origin and must not be able to point the next download at its own server.
const CATALOG = '../../src/js/readers/neural-voice/catalog.js'
const HF = 'https://huggingface.co/rhasspy/piper-voices/resolve/main/'
beforeEach(() => { vi.resetModules() })
afterEach(() => { delete globalThis.INHOUSE_NEURAL_VOICE_BASE })

describe('neuralVoiceBase', () => {
  it('is Hugging Face by default', async () => {
    const { neuralVoiceBase } = await import(CATALOG)
    expect(neuralVoiceBase()).toBe(HF)
  })
  it('honours an https override (or the local test mirror) set before the app starts, and adds the slash', async () => {
    globalThis.INHOUSE_NEURAL_VOICE_BASE = 'https://mirror.example/voices'
    expect((await import(CATALOG)).neuralVoiceBase()).toBe('https://mirror.example/voices/')
    vi.resetModules()
    globalThis.INHOUSE_NEURAL_VOICE_BASE = 'http://127.0.0.1:4321/hf/'
    expect((await import(CATALOG)).neuralVoiceBase()).toBe('http://127.0.0.1:4321/hf/')
  })
  it('ignores a plain-http remote host, a non-URL and a non-string', async () => {
    for (const value of ['http://attacker.example/voices/', 'not a url', 'javascript:alert(1)', 42, {}]) {
      vi.resetModules()
      globalThis.INHOUSE_NEURAL_VOICE_BASE = value
      expect((await import(CATALOG)).neuralVoiceBase()).toBe(HF)
    }
  })
  it('ignores what is set after the module loaded (an EPUB script runs later)', async () => {
    const { neuralVoiceBase, voiceUrls } = await import(CATALOG)
    globalThis.INHOUSE_NEURAL_VOICE_BASE = 'https://attacker.example/voices/'
    expect(neuralVoiceBase()).toBe(HF)
    expect(voiceUrls('es_MX-claude-high').model.startsWith(HF)).toBe(true)
  })
  it('reads an explicit env object as it is (the unit tests of the store use that)', async () => {
    const { neuralVoiceBase } = await import(CATALOG)
    expect(neuralVoiceBase({ INHOUSE_NEURAL_VOICE_BASE: 'https://mirror.example/x/' })).toBe('https://mirror.example/x/')
    expect(neuralVoiceBase({ INHOUSE_NEURAL_VOICE_BASE: 'http://attacker.example/x/' })).toBe(HF)
  })
})
