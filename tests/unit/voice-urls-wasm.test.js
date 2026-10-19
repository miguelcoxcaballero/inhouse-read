// @vitest-environment node
import './helpers/rust-ui-ready.js'
import { describe, expect, it } from 'vitest'
import { DEFAULT_VOICE_BASE, piperVoices } from '../../src/js/readers/neural-voice/catalog.js'
import { voiceUrls } from '../../src/js/readers/neural-voice/store.js'
import * as frozen from './helpers/reference-voice-urls.js'

// The Piper URL helpers moved to rust-ui voice_urls.rs; reference-voice-urls.js is the frozen original.
function outcome(run) {
  try { const value = run(); return { value, keys:Object.keys(value) } } catch (error) { return { error:error.constructor.name } }
}
const same = (id, base) => expect(outcome(() => voiceUrls(id, base))).toEqual(outcome(() => frozen.voiceUrls(id, base)))

describe('voice URLs in Rust', () => {
  it('matches every catalogued voice with the default, a mirror and the default base argument', () => {
    for (const { piperId } of piperVoices) {
      for (const base of [DEFAULT_VOICE_BASE, 'https://mirror.test/voices/', 'http://127.0.0.1:4321/hf/']) same(piperId, base)
      expect(voiceUrls(piperId)).toEqual(frozen.voiceUrls(piperId))
    }
  })
  it('matches unusual ids and bases, including the exact errors of invalid URLs', () => {
    const ids = ['', '-', '--', 'a', 'a-b', 'a_b-c-d-e', 'es_MX-claude-high', 'pt_PT-tugão-medium', 'ca_ES-upc_pau-x_low', 'x-\ud800-y',
      '😀_x-n-q', 'sr_RS-marko-medium', 'he_IL-saspeech-medium', 7, null, undefined, true, ['a-b', 'c'], { toString:() => 'o-p-q' }, new String('sr_RS-marko-medium')]
    const bases = [DEFAULT_VOICE_BASE, DEFAULT_VOICE_BASE.slice(0, -1), 'https://mirror.test/', 'relative/', '', 'not a url', 'https://h.test/a b/', 3, null, undefined]
    for (const id of ids) for (const base of bases) same(id, base)
    expect(() => voiceUrls(Symbol('x'), DEFAULT_VOICE_BASE)).toThrow(TypeError)
  })
  it('keeps the special models and the order of the fields', () => {
    expect(Object.keys(voiceUrls('he_IL-saspeech-medium', DEFAULT_VOICE_BASE))).toEqual(['model', 'config', 'catalogue', 'key', 'phonemizerModel', 'phonemizerSize', 'phonemizerSha256'])
    expect(voiceUrls('he_IL-saspeech-medium', DEFAULT_VOICE_BASE).phonemizerModel).toBe(frozen.NAKDIMON.url)
    expect(Object.keys(voiceUrls('sr_RS-marko-medium', DEFAULT_VOICE_BASE))).toEqual(['model', 'config', 'catalogue', 'key', 'modelBytes'])
  })
})
