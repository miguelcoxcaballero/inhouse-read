import { describe, it, expect } from 'vitest'
import {
  NEURAL_ID_PREFIX, isNeuralId, normalizeNeuralVoice, normalizeVoices, scoreVoice, isHighQuality, isNatural, bestVoiceFor, needsBetterVoice, voiceLabel,
  buildVoiceGroups, orderNeuralVoices, recommendedNeuralFor, resolveVoice, rankedVoicesFor
} from '../../src/js/readers/voice-catalog.js'
import { NEURAL_PREFIX, isNeuralVoiceId } from '../../src/js/readers/neural-voice/index.js'
import { FAKE_CATALOG } from '../helpers/fake-neural-engine.js'

const android = (voiceURI, lang, quality, extra = {}) => ({ voiceURI, name:`${lang} voice`, lang, quality, latency:200, network:false, installed:true, features:[], ...extra })
const SYSTEM = normalizeVoices([android('es-es-x-eed-local', 'es-ES', 500), android('es-es-x-net', 'es-ES', 500, { network:true }), android('en-us-x-iom-local', 'en-US', 500), android('pt-br-x-afs-local', 'pt-BR', 400)])
const neural = (installed = []) => FAKE_CATALOG.map(entry => normalizeNeuralVoice(entry, installed))

describe('neural voices in the catalogue', () => {
  it('uses the same id prefix as the engine contract', () => {
    expect(NEURAL_ID_PREFIX).toBe(NEURAL_PREFIX)
    expect(isNeuralId('piper:es_ES-davefx-medium')).toBe(isNeuralVoiceId('piper:es_ES-davefx-medium'))
    expect(isNeuralId('es-es-x-eed-local')).toBe(false)
    expect(isNeuralId(null)).toBe(false)
  })
  it('turns a catalogue entry into a voice flagged neural, installed or not', () => {
    const [davefx] = neural(['piper:es_ES-davefx-medium'])
    expect(davefx).toMatchObject({ id:'piper:es_ES-davefx-medium', lang:'es-ES', base:'es', region:'ES', neural:true, installed:true, network:false, quality:null, sizeMB:63, recommended:true, tier:'medium' })
    expect(neural([])[0].installed).toBe(false)
    expect(normalizeNeuralVoice(FAKE_CATALOG[0], new Set([FAKE_CATALOG[0].id])).installed).toBe(true)
    expect(neural().find(voice => voice.id === 'piper:es_MX-claude-high').tier).toBe('high')
    expect(normalizeNeuralVoice({ id:'not-neural', lang:'es' })).toBeNull()
    expect(normalizeNeuralVoice({ id:'piper:x', lang:'' })).toBeNull()
    expect(normalizeNeuralVoice(null)).toBeNull()
  })
  it('an installed neural voice outscores every system voice, however good', () => {
    const [davefx] = neural(['piper:es_ES-davefx-medium'])
    const best = Math.max(...SYSTEM.map(scoreVoice), scoreVoice(normalizeVoices([android('x-google', 'es-ES', 500, { name:'Google neural studio multilingual premium' })])[0]))
    expect(scoreVoice(davefx)).toBeGreaterThan(best)
    expect(isHighQuality(davefx)).toBe(true)
    expect(isNatural(davefx)).toBe(true)
  })
  it('high quality and the recommended voice rank first among neural voices', () => {
    const [medium, high] = ['piper:es_ES-davefx-medium', 'piper:es_MX-claude-high'].map(id => neural().find(voice => voice.id === id))
    expect(scoreVoice(high)).toBeGreaterThan(scoreVoice({ ...medium, recommended:false }))
    expect(scoreVoice(medium)).toBeGreaterThan(scoreVoice({ ...medium, recommended:false }))
  })
  it('labels read "Natural · sin conexión"', () => {
    expect(voiceLabel(neural()[0])).toBe('Español (España) · Davefx · Natural · sin conexión')
    expect(voiceLabel(neural().find(voice => voice.id === 'piper:es_MX-claude-high'))).toBe('Español (México) · Claude · Natural · sin conexión')
  })
})

describe('choosing between neural and system voices', () => {
  const DAVEFX = 'piper:es_ES-davefx-medium', CLAUDE = 'piper:es_MX-claude-high', LESSAC = 'piper:en_US-lessac-high'
  it('without an explicit choice an installed neural voice of the language beats the system voices', () => {
    const voices = [...SYSTEM, ...neural([DAVEFX])]
    expect(bestVoiceFor(voices, 'es-ES', 'es-ES').id).toBe(DAVEFX)
    expect(resolveVoice(voices, { language:'es-ES' })).toMatchObject({ voiceId:DAVEFX, language:'es-ES' })
    expect(needsBetterVoice(voices, 'es-ES')).toBe(false)
  })
  it('a voice that is not installed is listed but never chosen', () => {
    const voices = [...SYSTEM, ...neural([])]
    expect(bestVoiceFor(voices, 'es-ES').id).toBe('es-es-x-eed-local')
    expect(rankedVoicesFor(voices, 'es').some(voice => voice.neural)).toBe(false)
    expect(resolveVoice(voices, { language:'es-ES', voiceId:DAVEFX }).voiceId).toBe('es-es-x-eed-local') // a preference that points at a deleted voice uses the best available one
  })
  it('only a voice of the language wins: Spanish neural does not take over an English book', () => {
    const voices = [...SYSTEM, ...neural([DAVEFX])]
    expect(bestVoiceFor(voices, 'en-US').id).toBe('en-us-x-iom-local')
    expect(bestVoiceFor(voices, 'fr-FR')).toBeNull()
  })
  it('an explicit choice always wins, a system voice over a neural one included', () => {
    const voices = [...SYSTEM, ...neural([DAVEFX, CLAUDE])]
    expect(resolveVoice(voices, { language:'es-ES', voiceId:'es-es-x-eed-local' }).voiceId).toBe('es-es-x-eed-local')
    expect(resolveVoice(voices, { language:'es-ES', voiceId:CLAUDE })).toMatchObject({ voiceId:CLAUDE, language:'es-MX' })
  })
  it('the book region decides between neural voices of one language', () => {
    const voices = [...SYSTEM, ...neural([DAVEFX, CLAUDE])]
    expect(bestVoiceFor(voices, 'es-MX').id).toBe(CLAUDE)
    expect(bestVoiceFor(voices, 'es-ES').id).toBe(DAVEFX)
  })
  it("'Voz multilingüe' picks each chunk's language: its installed neural voice, else the best system voice", () => {
    const voices = [...SYSTEM, ...neural([DAVEFX])]
    const options = { multilingual:true, voiceId:DAVEFX }
    expect(resolveVoice(voices, { ...options, language:'es-ES' }).voiceId).toBe(DAVEFX)
    expect(resolveVoice(voices, { ...options, language:'en-US' }).voiceId).toBe('en-us-x-iom-local') // no English neural installed
    expect(resolveVoice([...voices, ...neural([LESSAC])], { ...options, language:'en-US' }).voiceId).toBe(LESSAC)
    expect(resolveVoice([...SYSTEM, ...neural([LESSAC])], { multilingual:true, language:'es-ES' }).voiceId).toBe('es-es-x-eed-local')
  })
  it('keeps the existing ranking untouched when no neural voice is installed', () => {
    expect(bestVoiceFor(SYSTEM, 'es-ES').id).toBe('es-es-x-eed-local')
    expect(resolveVoice(SYSTEM, { language:'pt-BR' }).voiceId).toBe('pt-br-x-afs-local')
  })
})

describe('picker groups with neural voices', () => {
  it('lists installed neural voices apart, and keeps system groups system-only', () => {
    const groups = buildVoiceGroups([...SYSTEM, ...neural(['piper:es_ES-davefx-medium', 'piper:en_US-lessac-high'])], { bookLang:'es-ES', deviceLang:'en-US' })
    expect(groups.neural.map(item => item.id)).toEqual(['piper:es_ES-davefx-medium', 'piper:en_US-lessac-high'])
    expect(groups.neural[0].label).toBe('Español (España) · Davefx · Natural · sin conexión')
    expect([...groups.recommended, ...groups.all].some(item => item.voice.neural)).toBe(false)
    expect(groups.labels.get('piper:en_US-lessac-high')).toMatch(/Natural · sin conexión/)
    expect(buildVoiceGroups(SYSTEM, {}).neural).toEqual([])
  })
  it('orders the download list: book language first (its region, then recommended), then device language, then the rest', () => {
    const ids = list => list.map(voice => voice.id)
    expect(ids(orderNeuralVoices(neural(), { bookLang:'es-MX', deviceLang:'en-US' })).slice(0, 4)).toEqual(['piper:es_MX-claude-high', 'piper:es_ES-davefx-medium', 'piper:en_US-lessac-high', 'piper:en_GB-alba-medium'])
    expect(ids(orderNeuralVoices(neural(), { bookLang:'fr', deviceLang:'es-ES' })).slice(0, 3)).toEqual(['piper:fr_FR-siwis-medium', 'piper:es_ES-davefx-medium', 'piper:es_MX-claude-high'])
    // the rest follows es/en/fr/de/it/pt/ca
    expect(ids(orderNeuralVoices(neural(), { bookLang:'ca', deviceLang:'de' }))).toEqual([
      'piper:ca_ES-upc_ona-medium', 'piper:de_DE-thorsten-medium', 'piper:es_ES-davefx-medium', 'piper:es_MX-claude-high', 'piper:en_US-lessac-high', 'piper:en_GB-alba-medium',
      'piper:fr_FR-siwis-medium', 'piper:it_IT-paola-medium', 'piper:pt_BR-faber-medium'])
    expect(orderNeuralVoices(null)).toEqual([])
  })
  it('offers the recommended voice of the book language (its region first), or nothing', () => {
    expect(recommendedNeuralFor(neural(), 'es-MX').id).toBe('piper:es_MX-claude-high')
    expect(recommendedNeuralFor(neural(), 'es').id).toBe('piper:es_ES-davefx-medium')
    expect(recommendedNeuralFor(neural(), 'en-GB').id).toBe('piper:en_GB-alba-medium')
    expect(recommendedNeuralFor(neural(), 'ja-JP')).toBeNull()
  })
})
