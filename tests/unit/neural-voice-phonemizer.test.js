// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { createPhonemizer, extraDictionaryOf, EXTRA_DICTIONARIES } from '../../src/js/readers/neural-voice/phonemizer.js'

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
    const ids = await phonemizer.phonemize('Hola "mundo".', 'es-419')
    expect(ids).toEqual([1, 0, 5, 0, 2])
    const module = await factory.mock.results[0].value
    expect(module.callMain).toHaveBeenCalledWith(['-l', 'es-419', '--input', JSON.stringify([{ text: 'Hola "mundo".' }]), '--espeak_data', '/espeak-ng-data'])
  })

  it('does not leak the output of one call into the next', async () => {
    let n = 0
    const { importModule } = fakeModule((hooks) => { if (++n === 1) hooks.print(JSON.stringify({ phoneme_ids: [1, 0, 2] })) })
    const phonemizer = await createPhonemizer({ base: 'https://site/phon/', importModule })
    expect(await phonemizer.phonemize('a', 'es')).toEqual([1, 0, 2])
    await expect(phonemizer.phonemize('b', 'es')).rejects.toThrow(/no output/)
  })

  it('explains what espeak said when there is no output', async () => {
    const { importModule } = fakeModule((hooks) => hooks.printErr('Failed to open voice xx'))
    const phonemizer = await createPhonemizer({ base: 'https://site/phon/', importModule })
    await expect(phonemizer.phonemize('a', 'xx')).rejects.toThrow(/Failed to open voice xx/)
  })
})

describe('dictionaries of the added languages', () => {
  const dictionaryFetch = () => vi.fn(async url => ({ ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode(`dict of ${url}`).buffer }))
  const withFiles = respond => {
    const written = []
    const factory = vi.fn(async hooks => ({ hooks, FS_createDataFile: (...args) => written.push(args), callMain: vi.fn(args => respond(hooks, args)) }))
    return { factory, written, importModule: vi.fn(async () => ({ default: factory })) }
  }

  it('maps the espeak voice of a Piper config to the dictionary it needs, and none for the languages inside the data pack', () => {
    expect(['ru', 'pl', 'cmn', 'nb', 'zh', 'uk', 'vi', 'ar', 'el'].map(extraDictionaryOf)).toEqual(['ru', 'pl', 'cmn', 'no', 'cmn', 'uk', 'vi', 'ar', 'el'])
    for (const voice of ['es', 'es-419', 'en-us', 'en-gb', 'fr', 'de', 'it', 'pt-br', 'pt', 'ca', '', undefined]) expect(extraDictionaryOf(voice)).toBe('')
    expect(EXTRA_DICTIONARIES).toHaveLength(new Set(EXTRA_DICTIONARIES).size)
  })

  it('fetches the dictionary of a language outside the data pack once, writes it into espeak-ng-data and keeps it for a rebuilt module', async () => {
    const { factory, importModule, written } = withFiles((hooks) => hooks.print(JSON.stringify({ phoneme_ids: [1, 0, 2] })))
    const fetchFile = dictionaryFetch()
    const phonemizer = await createPhonemizer({ base: 'https://site/phon/', importModule, fetchFile, rebuildEvery: 2 })
    await phonemizer.phonemize('Привет', 'ru')
    await phonemizer.phonemize('Мир', 'ru')
    expect(fetchFile).toHaveBeenCalledTimes(1)
    expect(fetchFile).toHaveBeenCalledWith('https://site/phon/dict/ru_dict')
    expect(written).toHaveLength(1)
    expect(written[0].slice(0, 2)).toEqual(['/espeak-ng-data', 'ru_dict'])
    expect(new TextDecoder().decode(written[0][2])).toBe('dict of https://site/phon/dict/ru_dict')
    await phonemizer.phonemize('Да', 'ru') // third call: a fresh module (rebuildEvery 2) gets the file again, from memory
    expect(factory).toHaveBeenCalledTimes(2)
    expect(written).toHaveLength(2)
    expect(fetchFile).toHaveBeenCalledTimes(1)
  })

  it('never fetches anything for the languages of the data pack', async () => {
    const { importModule, written } = withFiles((hooks) => hooks.print(JSON.stringify({ phoneme_ids: [1, 2] })))
    const fetchFile = dictionaryFetch()
    const phonemizer = await createPhonemizer({ base: 'https://site/phon/', importModule, fetchFile })
    for (const voice of ['es-419', 'en-us', 'fr', 'de', 'it', 'pt-br', 'ca']) await phonemizer.phonemize('x', voice)
    expect(fetchFile).not.toHaveBeenCalled()
    expect(written).toEqual([])
  })

  it('a missing dictionary is a clear error, not a silent wrong pronunciation', async () => {
    const { importModule } = withFiles((hooks) => hooks.print(JSON.stringify({ phoneme_ids: [1, 2] })))
    const phonemizer = await createPhonemizer({ base: 'https://site/phon/', importModule, fetchFile: async () => ({ ok: false, status: 404 }) })
    await expect(phonemizer.phonemize('x', 'pl')).rejects.toThrow(/dictionary "pl" not available \(404\)/)
  })
})

