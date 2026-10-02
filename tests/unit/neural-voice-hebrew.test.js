// @vitest-environment node
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createHebrewPhonemizer, normalizeNakdimonCharacter, nakdimonInputIds, mergeNiqqud, hebrewToIpa, phonemeIdsFromIpa } from '../../src/js/readers/neural-voice/hebrew.js'
import * as pcm from '../../src/js/readers/neural-voice/pcm.js'
import { IPA_ORACLES, NAKDIMON_ORACLE, NON_DECIMAL_DIGIT_RANGES } from './fixtures/hebrew-oracles.js'

const ID_MAP = {
  _: [0], '^': [1], '$': [2], ' ': [3], a: [14], b: [15], d: [17], e: [18], f: [19], h: [20],
  i: [21], j: [22], k: [23], l: [24], m: [25], n: [26], o: [27], s: [31], t: [32], u: [33],
  v: [34], z: [38], g: [154], χ: [127], ʁ: [94], ʃ: [96], ʔ: [109], 'ˈ': [120]
}
const CONFIG = { phoneme_type: 'hebrew', phoneme_id_map: ID_MAP, audio: { sample_rate: 22050 }, espeak: { voice: 'he' }, num_symbols: 256 }
const active = []
afterEach(async () => { for (const phonemizer of active.splice(0)) await phonemizer.destroy().catch(() => {}) })

const tensor = (data, dims, type = 'float32') => ({ type, data, dims, dispose: vi.fn() })
function outputsForClasses(classes) {
  return Object.fromEntries([['N', 16], ['D', 3], ['S', 4]].map(([name, count]) => {
    const data = new Float32Array(classes.length * count).fill(-1)
    for (let index = 0; index < classes.length; index++) data[index * count + (classes[index][name] || 0)] = 1
    return [name, tensor(data, [1, classes.length, count])]
  }))
}

function outputsForDotted(text) {
  const glyphs = []
  for (const letter of text) {
    if (/[\u05B0-\u05BC\u05BF\u05C1\u05C2\u05C7]/u.test(letter)) glyphs.at(-1).marks.push(letter)
    else glyphs.push({ letter, marks: [] })
  }
  const vowelClasses = new Map(Array.from({ length: 12 }, (_, index) => [String.fromCodePoint(0x05B0 + index), index + 2]))
  return outputsForClasses(glyphs.map(({ marks }) => ({
    N: marks.map(mark => vowelClasses.get(mark)).find(id => id !== undefined) || 0,
    D: marks.includes('\u05BC') ? 2 : 0,
    S: marks.includes('\u05C1') ? 2 : marks.includes('\u05C2') ? 3 : 0
  })))
}

function fakeOrt(run = () => outputsForDotted(NAKDIMON_ORACLE.dotted)) {
  const inputs = []
  const session = { inputNames: ['input_1'], outputNames: ['S', 'N', 'D'], run: vi.fn(run), release: vi.fn(async () => {}) }
  class Tensor {
    constructor(type, data, dims) { Object.assign(this, tensor(data, dims, type)); inputs.push(this) }
  }
  return { ort: { Tensor, InferenceSession: { create: vi.fn(async () => session) } }, session, inputs }
}

async function create(fake, overrides = {}) {
  const phonemizer = await createHebrewPhonemizer({ ort: fake.ort, model: Uint8Array.of(11).buffer, config: CONFIG, ...overrides })
  active.push(phonemizer)
  return phonemizer
}

describe('Hebrew upstream tables and IPA parity', () => {
  it('keeps final forms in the trained alphabet and counts code points, not UTF-16 units', () => {
    expect(Array.from(nakdimonInputIds('ךםןףץ'))).toEqual([26, 29, 31, 35, 37])
    expect(Array.from(nakdimonInputIds('🙂A٣²'))).toEqual([2, 2, 3, 3])
    expect(Array.from(nakdimonInputIds('שָׁלוֹם'))).toEqual(Array.from(nakdimonInputIds('שלום')))
  })

  it('normalizes only the characters the official model normalizes', () => {
    expect(Array.from('\n\t־‒–—―−[]´‘’“”״…ײװױ').map(normalizeNakdimonCharacter).join('')).toBe('  ------()\'\'\'""",HHH')
    expect(normalizeNakdimonCharacter('\r')).toBe('O')
    expect(normalizeNakdimonCharacter('é')).toBe('O')
    for (const letter of '012٣９') expect(normalizeNakdimonCharacter(letter)).toBe('5')
    for (const [first, last] of NON_DECIMAL_DIGIT_RANGES) {
      for (let code = first; code <= last; code++) expect(normalizeNakdimonCharacter(String.fromCodePoint(code))).toBe('5')
    }
    for (const letter of '½Ⅳ⑩') expect(normalizeNakdimonCharacter(letter)).toBe('O')
  })

  it.each(IPA_ORACLES)('matches Python IPA for %s', (text, expected) => {
    expect(hebrewToIpa(text)).toBe(expected)
    expect(hebrewToIpa(text.normalize('NFC'))).toBe(expected)
  })

  it('groups non-Hebrew combining marks by canonical class and uses Python whitespace', () => {
    expect(hebrewToIpa('שָׁנָה\u0301')).toBe('ʃanˈa') // accent: combining class 230
    expect(hebrewToIpa('שָׁנָה\u034F')).toBe('ʃˈanah') // CGJ: Mark category but combining class 0
    expect(hebrewToIpa('שָׁלוֹם\u0085עוֹלָם')).toBe('ʃˈalom ʔˈolam')
    expect(hebrewToIpa('שָׁנָה\uFEFF')).toBe('ʃˈanah') // Python does not treat BOM as whitespace
  })

  it('keeps both patah classes, merges dagesh/dot/vowel in order, and removes rafe', () => {
    const outputs = outputsForClasses([{ N: 15, D: 2, S: 2 }, { N: 1, D: 1, S: 1 }])
    expect(mergeNiqqud(['ש', 'ב'], outputs)).toBe('ש\u05BC\u05C1\u05B7ב')
    expect(mergeNiqqud(['ש'], outputsForClasses([{ N: 9, D: 2, S: 2 }]))).toBe('ש\u05BC\u05C1\u05B7')
  })

  it('pads each code point using the config table, including multi-id entries, and skips unknown IPA', () => {
    const map = { _: [8, 9], '^': [6], '$': [7], a: [14, 15], 'ˈ': [120] }
    expect(phonemeIdsFromIpa('a?ˈ', map)).toEqual([6, 8, 9, 14, 15, 8, 9, 120, 8, 9, 7])
    expect(phonemeIdsFromIpa('', map)).toEqual([])
  })
})

describe('Nakdimon ORT lifecycle', () => {
  it('uses cached bytes, WASM, and disables both growing memory caches', async () => {
    const fake = fakeOrt(), phonemizer = await create(fake)
    expect(fake.ort.InferenceSession.create).toHaveBeenCalledWith(Uint8Array.of(11), {
      executionProviders: ['wasm'], graphOptimizationLevel: 'all', enableCpuMemArena: false, enableMemPattern: false
    })
    const ids = await phonemizer.phonemize(NAKDIMON_ORACLE.text)
    expect(ids).toEqual(phonemeIdsFromIpa(hebrewToIpa(NAKDIMON_ORACLE.dotted), ID_MAP))
    const feeds = fake.session.run.mock.calls[0][0]
    expect(feeds.input_1).toMatchObject({ type: 'float32', dims: [1, Array.from(NAKDIMON_ORACLE.text).length] })
    expect(feeds.input_1.data).toEqual(nakdimonInputIds(NAKDIMON_ORACLE.text))
    expect(feeds.input_1.dispose).toHaveBeenCalledOnce()
    const outputs = await fake.session.run.mock.results[0].value
    for (const output of Object.values(outputs)) expect(output.dispose).toHaveBeenCalledOnce()
  })

  it('keeps originals when model normalization maps punctuation or emoji to other characters', async () => {
    const fake = fakeOrt(() => outputsForClasses([{ N: 15, D: 0, S: 2 }, {}, {}, {}]))
    const phonemizer = await create(fake)
    expect(await phonemizer.phonemize('ש−٣🙂')).toEqual(phonemeIdsFromIpa(hebrewToIpa('ש\u05C1\u05B7−٣🙂'), ID_MAP))
    expect(fake.inputs[0].dims).toEqual([1, 4])
    expect(Array.from(fake.inputs[0].data)).toEqual([41, 11, 3, 2])
  })

  it('preserves already pointed text and the upstream any-point bypass, without model inference', async () => {
    const fake = fakeOrt(), phonemizer = await create(fake)
    expect(await phonemizer.phonemize(NAKDIMON_ORACLE.dotted)).toEqual(phonemeIdsFromIpa(hebrewToIpa(NAKDIMON_ORACLE.dotted), ID_MAP))
    const mixed = 'שָׁלוֹם שלום'
    expect(await phonemizer.phonemize(mixed)).toEqual(phonemeIdsFromIpa(hebrewToIpa(mixed), ID_MAP))
    expect(await phonemizer.phonemize('')).toEqual([])
    expect(fake.session.run).not.toHaveBeenCalled()
  })

  it('selects the first argmax tie, reads named heads regardless of order and releases extra outputs', async () => {
    const outputs = outputsForClasses([{ N: 9, D: 0, S: 2 }])
    outputs.N.data[15] = outputs.N.data[9]
    outputs.S.data[3] = outputs.S.data[2]
    outputs.extra = tensor(Float32Array.of(0), [1])
    const fake = fakeOrt(() => outputs), phonemizer = await create(fake)
    expect(await phonemizer.phonemize('ש')).toEqual(phonemeIdsFromIpa('ʃˈa', ID_MAP))
    for (const output of Object.values(outputs)) expect(output.dispose).toHaveBeenCalledOnce()
  })

  it.each([
    ['missing head', outputs => { delete outputs.D }],
    ['wrong rank', outputs => { outputs.N.dims = [1, 16] }],
    ['wrong length', outputs => { outputs.N.dims = [1, 2, 16] }],
    ['wrong classes', outputs => { outputs.S.dims = [1, 1, 3] }],
    ['wrong data length', outputs => { outputs.D.data = Float32Array.of(0) }],
    ['wrong type', outputs => { outputs.N.type = 'int32' }],
    ['NaN', outputs => { outputs.N.data[0] = NaN }],
    ['Infinity', outputs => { outputs.S.data[0] = Infinity }]
  ])('rejects %s and releases every available tensor', async (_, mutate) => {
    const outputs = outputsForClasses([{ N: 9, S: 2 }])
    mutate(outputs)
    const fake = fakeOrt(() => outputs), phonemizer = await create(fake)
    await expect(phonemizer.phonemize('ש')).rejects.toThrow(/Nakdimon/)
    expect(fake.inputs[0].dispose).toHaveBeenCalledOnce()
    for (const output of Object.values(outputs)) expect(output.dispose).toHaveBeenCalledOnce()
    fake.session.run.mockImplementation(() => outputsForClasses([{ N: 9, S: 2 }]))
    expect(await phonemizer.phonemize('ש')).toEqual(phonemeIdsFromIpa('ʃˈa', ID_MAP))
  })

  it('releases the input when inference rejects and remains reusable', async () => {
    const fake = fakeOrt(() => { throw new Error('ORT failed') }), phonemizer = await create(fake)
    await expect(phonemizer.phonemize('ש')).rejects.toThrow('ORT failed')
    expect(fake.inputs[0].dispose).toHaveBeenCalledOnce()
    fake.session.run.mockImplementation(() => outputsForClasses([{ N: 9, S: 2 }]))
    expect(await phonemizer.phonemize('ש')).toEqual(phonemeIdsFromIpa('ʃˈa', ID_MAP))
  })

  it('rejects missing cached models/maps before creating a session and releases bad session metadata', async () => {
    const fake = fakeOrt()
    await expect(create(fake, { model: undefined })).rejects.toThrow(/model/)
    await expect(create(fake, { config: {} })).rejects.toThrow(/map/)
    expect(fake.ort.InferenceSession.create).not.toHaveBeenCalled()
    fake.session.outputNames = ['N', 'D']
    await expect(create(fake)).rejects.toThrow(/inputs or outputs/)
    expect(fake.session.release).toHaveBeenCalledOnce()
  })

  it('serializes inference, waits for its tensors before releasing, and rejects queued/late work', async () => {
    let finish
    const pending = new Promise(resolve => { finish = resolve })
    const outputs = outputsForClasses([{ N: 9, S: 2 }])
    const fake = fakeOrt(() => pending), phonemizer = await create(fake)
    const first = phonemizer.phonemize('ש'), second = phonemizer.phonemize('ש')
    const firstRejected = expect(first).rejects.toThrow(/released/)
    const secondRejected = expect(second).rejects.toThrow(/released/)
    await vi.waitFor(() => expect(fake.session.run).toHaveBeenCalledOnce())
    const releasing = phonemizer.destroy()
    expect(phonemizer.destroy()).toBe(releasing)
    expect(fake.session.release).not.toHaveBeenCalled()
    finish(outputs)
    await firstRejected; await secondRejected; await releasing
    expect(fake.session.run).toHaveBeenCalledOnce()
    expect(fake.inputs[0].dispose).toHaveBeenCalledOnce()
    for (const output of Object.values(outputs)) expect(output.dispose).toHaveBeenCalledOnce()
    expect(fake.session.release).toHaveBeenCalledOnce()
    await expect(phonemizer.phonemize('שָׁלוֹם')).rejects.toThrow(/released/)
  })
})

function workerHarness({ voiceFailure = false } = {}) {
  const fake = fakeOrt(() => outputsForClasses([{ N: 9, S: 2 }]))
  const voiceSession = {
    inputNames: ['input', 'input_lengths', 'scales'], outputNames: ['output'], release: vi.fn(async () => {}),
    run: vi.fn(async () => ({ output: tensor(Float32Array.from({ length: 2205 }, (_, index) => Math.sin(index / 10) / 2), [1, 1, 2205]) }))
  }
  fake.ort.env = { wasm: {}, versions: { common: 'fake' } }
  fake.ort.InferenceSession.create.mockImplementation(async bytes => {
    if (bytes[0] === 11) return fake.session
    if (voiceFailure) throw new Error('voice create failed')
    return voiceSession
  })
  const espeak = { phonemize: vi.fn(async () => [1, 0, 14, 0, 2]) }
  const messages = [], self = { postMessage: message => messages.push(message) }
  const source = readFileSync(new URL('../../src/js/readers/neural-voice/worker.js', import.meta.url), 'utf8')
    .replace(/^import .*$/gm, '')
    .replace("import(/* @vite-ignore */ ortBase + 'ort.wasm.min.mjs')", 'Promise.resolve(__ort)')
  runInNewContext(source, { self, __ort: fake.ort, createPhonemizer: async () => espeak, createHebrewPhonemizer,
    ...pcm, performance, setTimeout, Uint8Array, Float32Array, BigInt64Array, ArrayBuffer })
  let id = 0
  const send = async message => { const request = { ...message, id: ++id }; await self.onmessage({ data: request }); return request.id }
  return { ...fake, voiceSession, espeak, messages, send }
}

describe('Hebrew synthesis worker integration', () => {
  it('synthesizes Hebrew IDs without espeak and releases both sessions on voice switch', async () => {
    const worker = workerHarness()
    await worker.send({ type: 'init', ortBase: '/', phonBase: '/' })
    await worker.send({ type: 'load', voice: 'he', config: CONFIG, model: Uint8Array.of(22).buffer, phonemizerModel: Uint8Array.of(11).buffer })
    const id = await worker.send({ type: 'synth', text: 'שָׁלוֹם', rate: 1 })
    await vi.waitFor(() => expect(worker.messages).toContainEqual({ type: 'end', id }))
    expect(worker.espeak.phonemize).not.toHaveBeenCalled()
    expect(Array.from(worker.voiceSession.run.mock.calls[0][0].input.data, Number)).toEqual(phonemeIdsFromIpa('ʃˈalom', ID_MAP))
    expect(worker.ort.env.wasm).toMatchObject({ numThreads: 1, proxy: false })
    await worker.send({ type: 'load', voice: 'es', config: { ...CONFIG, phoneme_type: 'espeak', espeak: { voice: 'es' } }, model: Uint8Array.of(22).buffer })
    expect(worker.session.release).toHaveBeenCalledOnce()
    expect(worker.voiceSession.release).toHaveBeenCalledOnce()
    const esId = await worker.send({ type: 'synth', text: 'Hola', rate: 1 })
    await vi.waitFor(() => expect(worker.messages).toContainEqual({ type: 'end', id: esId }))
    expect(worker.espeak.phonemize).toHaveBeenCalledWith('Hola', 'es')
    await worker.send({ type: 'free' })
    expect(worker.voiceSession.release).toHaveBeenCalledTimes(2)
    expect(worker.session.release).toHaveBeenCalledOnce()
  })

  it('releases both sessions on free and also releases Nakdimon when voice creation fails', async () => {
    for (const voiceFailure of [false, true]) {
      const worker = workerHarness({ voiceFailure })
      await worker.send({ type: 'init', ortBase: '/', phonBase: '/' })
      const id = await worker.send({ type: 'load', voice: 'he', config: CONFIG, model: Uint8Array.of(22).buffer, phonemizerModel: Uint8Array.of(11).buffer })
      if (voiceFailure) expect(worker.messages.find(message => message.id === id).type).toBe('error')
      await worker.send({ type: 'free' })
      expect(worker.session.release).toHaveBeenCalledOnce()
      expect(worker.voiceSession.release).toHaveBeenCalledTimes(voiceFailure ? 0 : 1)
    }
  })

  it('reports a missing auxiliary model before creating the voice session', async () => {
    const worker = workerHarness()
    await worker.send({ type: 'init', ortBase: '/', phonBase: '/' })
    const id = await worker.send({ type: 'load', voice: 'he', config: CONFIG, model: Uint8Array.of(22).buffer })
    expect(worker.messages.find(message => message.id === id)).toMatchObject({ type: 'error', error: expect.stringContaining('phonemizer model') })
    expect(worker.ort.InferenceSession.create).not.toHaveBeenCalled()
    await worker.send({ type: 'free' })
  })
})
