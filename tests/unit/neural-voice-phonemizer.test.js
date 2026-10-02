// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { createPhonemizer } from '../../src/js/readers/neural-voice/phonemizer.js'

/** The shape of the Emscripten module of piper_phonemize: a factory taking print/printErr/locateFile, giving callMain. */
const fakeModule = (respond) => {
  const factory = vi.fn(async hooks => ({ hooks, callMain: vi.fn(args => respond(hooks, args)) }))
  return { factory, importModule: vi.fn(async () => ({ default: factory })) }
}

describe('createPhonemizer', () => {
  it('loads the glue and the data from the given folder (never a CDN) and runs the program with the voice and the text', async () => {
    const { factory, importModule } = fakeModule((hooks, args) => hooks.print(JSON.stringify({ phoneme_ids: [1, 0, 5, 0, 2] })))
    const phonemizer = await createPhonemizer({ base: 'https://site/inhouse-read/neural-voice/phon/', importModule })
    expect(importModule).toHaveBeenCalledWith('https://site/inhouse-read/neural-voice/phon/piper_phonemize.mjs')
    const hooks = factory.mock.calls[0][0]
    expect(hooks.locateFile('piper_phonemize.wasm')).toBe('https://site/inhouse-read/neural-voice/phon/piper_phonemize.wasm')
    expect(hooks.locateFile('piper_phonemize.data')).toBe('https://site/inhouse-read/neural-voice/phon/piper_phonemize.data')
    const ids = phonemizer.phonemize('Hola "mundo".', 'es-419')
    expect(ids).toEqual([1, 0, 5, 0, 2])
    const module = await factory.mock.results[0].value
    expect(module.callMain).toHaveBeenCalledWith(['-l', 'es-419', '--input', JSON.stringify([{ text: 'Hola "mundo".' }]), '--espeak_data', '/espeak-ng-data'])
  })

  it('does not leak the output of one call into the next', async () => {
    let n = 0
    const { importModule } = fakeModule((hooks) => { if (++n === 1) hooks.print(JSON.stringify({ phoneme_ids: [1, 0, 2] })) })
    const phonemizer = await createPhonemizer({ base: 'https://site/phon/', importModule })
    expect(phonemizer.phonemize('a', 'es')).toEqual([1, 0, 2])
    expect(() => phonemizer.phonemize('b', 'es')).toThrow(/no output/)
  })

  it('explains what espeak said when there is no output', async () => {
    const { importModule } = fakeModule((hooks) => hooks.printErr('Failed to open voice xx'))
    const phonemizer = await createPhonemizer({ base: 'https://site/phon/', importModule })
    expect(() => phonemizer.phonemize('a', 'xx')).toThrow(/Failed to open voice xx/)
  })
})
