// @vitest-environment node
import './helpers/rust-ui-ready.js'
import { it, expect } from 'vitest'
import * as production from '../../src/js/readers/voice-catalog.js'
import * as original from './helpers/reference-voice-catalog.js'
import { neuralVoices } from '../../src/js/readers/neural-voice/catalog.js'

// The record of a neural voice, the choice of the voice that speaks, and the names of languages (rust-ui voice_catalog.rs)
// against the frozen JavaScript they replaced.
let seed = 99
const next = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0)
const pick = list => list[next() % list.length]
const outcome = run => { try { return { value: run() } } catch (error) { return { error: error.constructor.name } } }
const same = (a, b) => { expect(a.error).toBe(b.error); if (!a.error) { expect(a.value).toEqual(b.value); if (a.value && typeof a.value === 'object') expect(Object.keys(a.value)).toEqual(Object.keys(b.value)) } }

const TAGS = ['', 'es', 'es-ES', 'es_MX', 'ES-es', 'spa-ESP', 'pt-br', 'PT-BR', 'en', 'en-US', 'zh-Hans-CN', 'zh', 'nb', 'no', 'nor', 'heb', 'iw', 'xx', 'xx-XX', 'xx-123', 'de-DE-1996', 'ar-SA', 'ar-JO', 'ca-valencia', 'sr-Latn-RS', 'fil', 'tlh', 'ja-JP', 'ko', 'es-419', 'en-001', ' fr-FR ', '-', '--es', 'es--MX', 'fr-', 'sv-SE', 'hr-HR', 'lt', 'Ελ', 'İ', 'ß', null, undefined, 0, false, 5, {}, []]

it('reads language tags and names like the original, for every kind of tag', () => {
  for (const tag of TAGS) {
    expect(production.normalizeLang(tag)).toBe(original.normalizeLang(tag))
    expect(production.langBase(tag)).toBe(original.langBase(tag))
    same(outcome(() => production.languageName(tag)), outcome(() => original.languageName(tag)))
    same(outcome(() => production.baseLanguageName(tag)), outcome(() => original.baseLanguageName(tag)))
    same(outcome(() => production.regionName(tag)), outcome(() => original.regionName(tag)))
  }
  for (const voice of neuralVoices) { expect(production.languageName(voice.lang)).toBe(original.languageName(voice.lang)); expect(production.baseLanguageName(voice.lang)).toBe(original.baseLanguageName(voice.lang)) }
  expect(production.languageName('es-MX')).toBe('Español (México)')
})

it('tells the ids of the neural voices and the language a book declares like the original', () => {
  for (const id of ['piper:es_ES-davefx-medium', 'piper:', 'supertonic3:F1:es', 'supertonic3:M5:ja', 'supertonic3:F6:es', 'supertonic3:F1:ES', 'supertonic3:F1:esp', 'supertonic3:F1:e', 'supertonic3:F1:es\n', 'Piper:x', 'es-es-x-eed-local', '', null, undefined, 5, {}, ['piper:x']])
    expect(production.isNeuralId(id)).toBe(original.isNeuralId(id))
  const hostile = { get metadata() { throw new Error('no metadata') } }
  for (const reader of [null, undefined, {}, { metadata: null }, { metadata: {} }, { metadata: { language: 'es-ES' } }, { metadata: { language: ['en-GB', 'fr'] } }, { metadata: { language: [] } }, { metadata: { language: 5 } }, { metadata: { language: { toString() { throw new Error('x') } } } }, hostile])
    expect(production.declaredLanguage(reader)).toBe(original.declaredLanguage(reader))
})

const entries = () => [...neuralVoices.slice(0, 80), {
  id: 'piper:x', lang: 'es', name: 'N', quality: 'high', sizeMB: '63', speaker: '2', recommended: true, sharedPack: true, upgradeBytes: '15', modelKey: 'k', runtime: 'supertonic3', licenseUrl: 'u', licenseName: 'l', dialect: 'es-AR' },
  { id: 'piper:y', lang: 'fr' }, { id: 'piper:z', lang: 'de-DE', name: '', piperId: 'z', quality: 'low', sizeMB: NaN, speaker: -0, recommended: 'yes', sharedPack: 1, upgradeBytes: null },
  { id: 'supertonic3:F1:es', lang: 'es', dialect: 'es-ES', sizeMB: 250, upgradeBytes: 77, sharedPack: true }, { id: 'piper:q', lang: '' }, { id: 'piper:q', lang: null, dialect: 'ca' },
  { id: 'nope', lang: 'es' }, { lang: 'es' }, {}, null, undefined, 0, 'piper:x', [], () => 1, Object.create({ id: 'piper:inherited', lang: 'it' }), { id: 'piper:sym', lang: 'es', name: Symbol('s') },
  { id: 'piper:big', lang: 'es', sizeMB: 1e21, speaker: Infinity, upgradeBytes: '0x10' }]

it('turns catalogue entries into voices like the original, key for key', () => {
  const sets = [[], new Set(), undefined, null, new Set(['piper:x', 'piper:y']), ['piper:z', 'supertonic3:F1:es'], 'piper:x', new Set(neuralVoices.map(voice => voice.id)), 5, {}]
  let made = 0, refused = 0, failed = 0
  for (const entry of entries()) for (const installed of sets) {
    const a = outcome(() => production.normalizeNeuralVoice(entry, installed)), b = outcome(() => original.normalizeNeuralVoice(entry, installed))
    same(a, b)
    if (b.error) failed++; else if (b.value) made++; else refused++
  }
  expect(made).toBeGreaterThan(500)
  expect(refused).toBeGreaterThanOrEqual(100)
  expect(failed).toBeGreaterThan(5)
  for (const entry of entries()) same(outcome(() => production.normalizeNeuralVoice(entry)), outcome(() => original.normalizeNeuralVoice(entry)))
})

it('reads the properties of an entry in the order the original did', () => {
  const log = (name, trace) => ({
    get id() { trace.push('id'); return 'piper:order' }, get dialect() { trace.push('dialect'); return undefined }, get lang() { trace.push('lang'); return 'es-ES' }, get name() { trace.push('name'); return 'Name' },
    get piperId() { trace.push('piperId'); return 'p' }, get quality() { trace.push('quality'); return 'high' }, get sizeMB() { trace.push('sizeMB'); return 63 }, get speaker() { trace.push('speaker'); return 0 },
    get recommended() { trace.push('recommended'); return true }, get sharedPack() { trace.push('sharedPack'); return false }, get upgradeBytes() { trace.push('upgradeBytes'); return 0 },
    get modelKey() { trace.push('modelKey'); return undefined }, get runtime() { trace.push('runtime'); return undefined }, get licenseUrl() { trace.push('licenseUrl'); return undefined }, get licenseName() { trace.push('licenseName'); return undefined } })
  const a = [], b = []
  expect(production.normalizeNeuralVoice(log('a', a), [])).toEqual(original.normalizeNeuralVoice(log('b', b), []))
  expect(a).toEqual(b)
})

const REGIONS = ['ES', 'MX', 'AR', 'GB', 'US', 'FR', 'BR', 'PT']
function randomCatalog() {
  const size = next() % 14
  return Array.from({ length: size }, (_, index) => {
    const lang = pick(['es-ES', 'es-MX', 'es-AR', 'en-US', 'en-GB', 'fr-FR', 'pt-BR', 'pt-PT', 'ca-ES', 'de-DE', 'es']), id = `piper:${lang}-${next() % 5}-${index}`
    const entry = production.normalizeNeuralVoice({ id, lang, name: pick(['Ana', 'Ben', 'ana', 'Zoe']), quality: pick(['high', 'medium', 'low']), recommended: next() % 3 === 0 }, [])
    entry.installed = next() % 3 !== 0
    if (next() % 9 === 0) entry.region = pick(REGIONS)
    if (next() % 17 === 0) delete entry.installed
    return entry
  })
}

it('chooses the voice for 20000 random lists and options exactly like the original', () => {
  let chosen = 0, none = 0, thrown = 0, multilingual = 0
  const languages = ['', 'es', 'es-ES', 'es-MX', 'es_AR', 'en', 'en-US', 'en-GB', 'fr', 'pt-BR', 'pt', 'de', 'ca', 'xx', 'it', undefined, null, 'ES-es', 'spa-ESP']
  for (let round = 0; round < 20000; round++) {
    const clean = round % 11 === 0 ? pick([undefined, null, {}, 'x', []]) : randomCatalog()
    const voices = round % 97 === 0 && Array.isArray(clean) ? [...clean, pick([null, undefined, 5])] : clean
    const options = round % 13 === 0 ? undefined : {
      voiceId: pick(['', undefined, null, 'piper:nothing', ...(Array.isArray(clean) && clean.length ? [pick(clean).id, pick(clean).id] : [])]),
      language: pick(languages), multilingual: pick([undefined, false, true, 1, 0, '']), deviceLang: pick(languages) }
    const optional = options && round % 7 === 0 ? Object.fromEntries(Object.entries(options).filter(() => next() % 2)) : options
    const a = outcome(() => production.resolveVoice(voices, optional)), b = outcome(() => original.resolveVoice(voices, optional))
    expect(a.error).toBe(b.error)
    if (b.error) thrown++
    if (b.value) {
      if (b.value.voice) chosen++; else none++
      if (optional?.multilingual) multilingual++
      expect(a.value.voice).toBe(b.value.voice)
      expect(a.value.voiceId).toBe(b.value.voiceId)
      expect(a.value.language).toBe(b.value.language)
      expect(Object.keys(a.value)).toEqual(Object.keys(b.value))
    }
  }
  // The corpus must exercise the choice, the empty answer, the errors and the multilingual option.
  expect(chosen).toBeGreaterThan(5000)
  expect(none).toBeGreaterThan(1000)
  expect(thrown).toBeGreaterThan(100)
  expect(multilingual).toBeGreaterThan(500)
})

it('breaks ties between equal voices by the browser collation of their ids, earliest first', () => {
  const voices = ['piper:b', 'piper:a', 'piper:B', 'piper:ä', 'piper:a'].map((id, index) => ({ ...production.normalizeNeuralVoice({ id, lang: 'es-ES', name: 'n' + index }, [id]) }))
  const a = production.resolveVoice(voices, { language: 'es' }), b = original.resolveVoice(voices, { language: 'es' })
  expect(a.voiceId).toBe(b.voiceId)
  expect(voices.indexOf(a.voice)).toBe(voices.indexOf(b.voice))
})

it('leaves a list with a voice of the device to the caller as an error, not a guess', () => {
  const device = { id: 'es-es-x-eed-local', name: 'device', lang: 'es-ES', base: 'es', region: 'ES', quality: 500, network: false, installed: true }
  const neural = production.normalizeNeuralVoice({ id: 'piper:a', lang: 'es-ES', name: 'A' }, ['piper:a'])
  expect(() => production.resolveVoice([device, neural], { language: 'es' })).toThrow(TypeError)
  expect(production.resolveVoice([neural, { ...device, installed: false }], { language: 'es' }).voice).toBe(neural)
})
