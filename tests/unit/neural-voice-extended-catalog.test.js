// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { neuralVoices, voiceUrls, recommendedVoice, NAKDIMON } from '../../src/js/readers/neural-voice/catalog.js'
import { detectLanguage, normalizeLang, languageName } from '../../src/js/readers/voice-catalog.js'

describe('remaining natural voice languages', () => {
  it.each([
    ['pt-PT', 'pt_PT-tugão-medium'], ['bg-BG', 'bg_BG-dimitar-medium'],
    ['sr-RS', 'sr_RS-marko-medium'], ['hi-IN', 'hi_IN-pratham-medium'], ['he-IL', 'he_IL-saspeech-medium']
  ])('%s offers the correct model %s', (lang, piperId) => {
    expect(recommendedVoice(lang).piperId).toBe(piperId)
    expect(neuralVoices.some(voice => voice.lang === lang)).toBe(true)
  })
  it('encodes the Portuguese filename consistently with Cache Storage Request.url', () => {
    const urls = voiceUrls('pt_PT-tugão-medium')
    expect(urls.model).toContain('tug%C3%A3o')
    expect(new Request(urls.model).url).toBe(urls.model)
    expect(urls.key).toContain('tugão') // keys in voices.json are unescaped
  })
  it('uses the Serbian author model, never the Sorbian dataset with a Serbian label', () => {
    const urls = voiceUrls('sr_RS-marko-medium')
    expect(urls.model).toMatch(/phantom9623\/piper-serbian-tts\/resolve\/[a-f0-9]{40}\/sr_Marko_medium\.onnx$/)
    expect(urls.modelBytes).toBe(63516051)
    expect(neuralVoices.some(voice => voice.piperId.includes('serbski_institut'))).toBe(false)
    expect(voiceUrls('sr_RS-marko-medium', 'https://mirror.test/').model).toBe('https://mirror.test/sr/sr_RS/marko/medium/sr_RS-marko-medium.onnx')
  })
  it('pins and budgets Hebrew pointing weights, and maps the auxiliary into test mirrors', () => {
    const urls = voiceUrls('he_IL-saspeech-medium')
    expect(urls.phonemizerModel).toBe(NAKDIMON.url)
    expect(urls.phonemizerSize).toBe(21312753)
    expect(urls.phonemizerSha256).toMatch(/^[a-f0-9]{64}$/)
    expect(voiceUrls('he_IL-saspeech-medium', 'https://mirror.test/').phonemizerModel).toBe('https://mirror.test/aux/nakdimon.onnx')
    expect(recommendedVoice('he').sizeMB).toBe(85)
  })
  it('uses the available Turkish model', () => {
    expect(recommendedVoice('tr').piperId).toBe('tr_TR-dfki-medium')
  })
  it('normalizes Bulgarian and Serbian metadata and labels', () => {
    expect(normalizeLang('bul-BG')).toBe('bg-BG')
    expect(normalizeLang('srp-RS')).toBe('sr-RS')
    expect(languageName('bg')).toBe('Búlgaro')
    expect(languageName('sr')).toBe('Serbio')
  })
  it('retains declared Bulgarian and Serbian for shared Cyrillic letters', () => {
    expect(detectLanguage('Нико у селу није памтио.', 'sr-RS')).toBe('sr-RS')
    expect(detectLanguage('Старата библиотека е тиха.', 'bg-BG')).toBe('bg-BG')
    expect(detectLanguage('Нико у селу није памтио.', 'en-US')).toBe('sr-RS')
    expect(detectLanguage('Никой не помнеше кога беше пристигнал.', 'en-US')).toBe('bg-BG')
    expect(detectLanguage('Дети шли по улице.', 'ru-RU')).toBe('ru-RU')
  })
})
