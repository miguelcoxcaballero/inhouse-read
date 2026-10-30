// @vitest-environment node
import { describe, expect, it } from 'vitest'
import * as catalog from '../../src/js/readers/neural-voice/catalog.js'
import * as supertonic from '../../src/js/readers/neural-voice/supertonic-catalog.js'
import * as frozenCatalog from './helpers/reference-neural-catalog.js'
import * as frozenSupertonic from './helpers/reference-supertonic-catalog.js'

// The voice catalogue (Piper models and speakers, the Supertonic pack, its languages, profiles and names) is a table of
// the app core (rust-core voice_catalogue.rs over supertonic_catalog.rs, written at build time). The frozen JavaScript
// originals are the two reference-*-catalog.js helpers; every export must be the same value, in the same key order, with
// the same frozenness.
const shape = value => JSON.stringify(value)
const frozenness = value => Array.isArray(value) ? [Object.isFrozen(value), value.map(frozenness)]
  : value && typeof value === 'object' ? [Object.isFrozen(value), Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, frozenness(inner)]))] : null

describe('voice catalogue tables in the app core', () => {
  it('exports exactly the names of the originals', () => {
    expect(Object.keys(catalog).sort()).toEqual(Object.keys(frozenCatalog).sort())
    expect(Object.keys(supertonic).filter(name => name !== 'VOICE_CATALOGUE').sort()).toEqual(Object.keys(frozenSupertonic).sort())
  })
  it('keeps every Piper voice record, its fields in order, and the derived lists', () => {
    for (const name of ['piperVoices', 'supertonicVoices', 'neuralVoices', 'DEFAULT_VOICE_BASE', 'NEURAL_PREFIX']) {
      expect(catalog[name]).toEqual(frozenCatalog[name])
      expect(shape(catalog[name])).toBe(shape(frozenCatalog[name]))
      expect(frozenness(catalog[name])).toEqual(frozenness(frozenCatalog[name]))
    }
    expect(catalog.neuralVoices).toHaveLength(259)
    expect([...catalog.modelsOf(catalog.neuralVoices)].map(([key, voices]) => [key, voices.map(voice => voice.id)]))
      .toEqual([...frozenCatalog.modelsOf(frozenCatalog.neuralVoices)].map(([key, voices]) => [key, voices.map(voice => voice.id)]))
  })
  it('keeps the Supertonic manifest, sizes, licence, languages, profiles and names', () => {
    for (const name of Object.keys(frozenSupertonic).filter(name => typeof frozenSupertonic[name] !== 'function')) {
      expect(supertonic[name]).toEqual(frozenSupertonic[name])
      expect(shape(supertonic[name])).toBe(shape(frozenSupertonic[name]))
      expect(frozenness(supertonic[name])).toEqual(frozenness(frozenSupertonic[name]))
    }
    // The legacy manifest holds the very asset objects of the full one.
    expect(supertonic.SUPERTONIC_LEGACY_ASSETS.every(asset => supertonic.SUPERTONIC_ASSETS.includes(asset))).toBe(true)
  })
  it('builds the same fresh profile records for any language list', () => {
    const lists = [[], ['es'], ['es-ES', 'es_MX', 'es'], ['nb-NO', 'zh-CN', 'he-IL'], frozenSupertonic.SUPERTONIC_LANGUAGES, [...frozenSupertonic.SUPERTONIC_LANGUAGES].reverse(),
      ['EN', 'en-US', 'ko_KR', 'xx', '', '-', '_ja', 'pt-BR-x'], [1, null, undefined, true, { toString:() => 'de-AT' }, new String('fr'), ['it']], ['__proto__', 'constructor', 'toString']]
    for (const languages of lists) {
      const mine = supertonic.supertonicVoicesFor(languages), theirs = frozenSupertonic.supertonicVoicesFor(languages)
      expect(mine).toEqual(theirs)
      expect(shape(mine)).toBe(shape(theirs))
    }
    const [first] = supertonic.supertonicVoicesFor(['es']), [again] = supertonic.supertonicVoicesFor(['es'])
    expect(first).not.toBe(again)
    first.name = 'changed'
    expect(supertonic.supertonicVoicesFor(['es'])[0].name).toBe('Lucía')
    expect(supertonic.supertonicVoicesFor([Symbol('x')])).toEqual(frozenSupertonic.supertonicVoicesFor([Symbol('x')]))
    expect(() => supertonic.supertonicVoicesFor('es')).toThrow(TypeError)
  })
  it('names, identifies and locates voices like the originals', () => {
    for (const lang of ['es', 'en', 'xx', '', '__proto__', 'constructor', undefined, null, 5])
      for (const style of ['F1', 'M5', 'F6', 'F0', 'X1', 'F', '', 'M1x', 1, null, undefined, ['F', 2]])
        expect(supertonic.supertonicVoiceName(lang, style)).toBe(frozenSupertonic.supertonicVoiceName(lang, style))
    for (const id of ['supertonic3:F1:es', 'supertonic3:M5:vi', 'supertonic3:F6:es', 'supertonic3:F1:esp', 'piper:es_MX-claude-high', 'piper:', '', null, 7, 'Supertonic3:F1:es'])
      expect([supertonic.isSupertonicVoiceId(id), catalog.isNeuralVoiceId(id)]).toEqual([frozenSupertonic.isSupertonicVoiceId(id), frozenCatalog.isNeuralVoiceId(id)])
    for (const env of [{}, { INHOUSE_NEURAL_VOICE_BASE:'https://mirror.test/hf' }, { INHOUSE_NEURAL_VOICE_BASE:'http://evil.test/' }, { INHOUSE_NEURAL_VOICE_BASE:'http://127.0.0.1:9/' }, null])
      expect(catalog.neuralVoiceBase(env)).toBe(frozenCatalog.neuralVoiceBase(env))
    expect(catalog.neuralVoiceBase()).toBe(frozenCatalog.neuralVoiceBase())
    expect(supertonic.supertonicBase()).toBe(frozenSupertonic.supertonicBase())
    for (const asset of supertonic.SUPERTONIC_ASSETS) for (const base of [undefined, supertonic.SUPERTONIC_BASE, 'http://127.0.0.1:4/st/'])
      expect(supertonic.supertonicAssetUrl(asset, base)).toBe(frozenSupertonic.supertonicAssetUrl(asset, base))
  })
})
