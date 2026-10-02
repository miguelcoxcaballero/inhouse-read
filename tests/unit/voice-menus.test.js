import { describe, expect, it } from 'vitest'
import { normalizeNeuralVoice, normalizeVoices } from '../../src/js/readers/voice-catalog.js'
import { languageOptions, orderLanguages, voiceOptions } from '../../src/js/readers/voice-menus.js'

const system = list => normalizeVoices(list.map(([voiceURI, name, lang, quality = 400, extra = {}]) => ({ voiceURI, name, lang, quality, network:false, installed:true, ...extra })))
const neural = (piperId, lang, name, installed = false, quality = 'medium') => normalizeNeuralVoice({ id:`piper:${piperId}`, piperId, lang, name, quality, sizeMB:63 }, installed ? [`piper:${piperId}`] : [])

describe('language dropdown', () => {
  it('orders the book language, the device language, the usual ones, then the rest A-Z', () => {
    expect(orderLanguages(['ru', 'fr', 'en', 'es', 'ar', 'de'], { bookLang:'fr-FR', deviceLang:'es-ES' })).toEqual(['fr', 'es', 'en', 'de', 'ar', 'ru'])
  })
  it('starts with Automática (the book language) and lists a language per voice found, with a count or "Por descargar"', () => {
    const voices = [neural('es_MX-claude-high', 'es-MX', 'Claude', true), neural('es_ES-davefx-medium', 'es-ES', 'Davefx', true), neural('en_GB-alba-medium', 'en-GB', 'Alba', true), neural('fr_FR-siwis-medium', 'fr-FR', 'Siwis'), neural('en_US-lessac-medium', 'en-US', 'Lessac', true)]
    expect(languageOptions(voices, { bookLang:'es', deviceLang:'en-US' })).toEqual([
      { value:'', label:'Automática', hint:'Español' },
      { value:'es', label:'Español', hint:'2 voces' },
      { value:'en', label:'Inglés', hint:'2 voces' },
      { value:'fr', label:'Francés', hint:'Por descargar' }
    ])
  })
  it('ignores device voices and asks for a language when the book has no natural voice in the catalogue', () => {
    const voices = system([['xx', 'Ghost', 'es-ES', 400, { installed:false }], ['ready', 'Device voice', 'es-ES']])
    expect(languageOptions(voices, { bookLang:'es' })).toEqual([{ value:'', label:'Automática', hint:'Elige un idioma' }])
  })
})

describe('voice dropdown', () => {
  it('lists Automática and the usable voices of the language, best first, naming the one Automática would use', () => {
    const voices = [neural('es_ES-davefx-medium', 'es-ES', 'Davefx', true), neural('es_MX-claude-high', 'es-MX', 'Claude', true, 'high'), neural('en_GB-alba-medium', 'en-GB', 'Alba', true)]
    const options = voiceOptions(voices, 'es', { bookLang:'es' })
    expect(options.map(option => option.value)).toEqual(['', 'piper:es_MX-claude-high', 'piper:es_ES-davefx-medium'])
    expect(options[0]).toMatchObject({ label:'Automática', hint:options[1].label })
  })
  it('gives equal natural voice names a number and keeps the region visible in each row', () => {
    const voices = [neural('es_ES-one-medium', 'es-ES', 'Voz', true), neural('es_ES-two-medium', 'es-ES', 'Voz', true), neural('es_MX-claude-high', 'es-MX', 'Claude', true)]
    const rows = voiceOptions(voices, 'es', { bookLang:'es' }).slice(1)
    expect(rows.map(option => option.label)).toEqual(['Voz 1', 'Voz 2', 'Claude'])
    expect(rows.map(option => option.hint)).toEqual(['España · Natural', 'España · Natural', 'México · Natural'])
  })
  it('lists installed natural voices (not the ones to download) and says so when no voice is there', () => {
    const voices = [neural('es_MX-claude-high', 'es-MX', 'Claude', true), neural('es_ES-davefx-medium', 'es-ES', 'Davefx')]
    const options = voiceOptions(voices, 'es', { bookLang:'es' })
    expect(options.map(option => option.value)).toEqual(['', 'piper:es_MX-claude-high'])
    expect(options[1]).toMatchObject({ label:'Claude', hint:'México · Natural' })
    expect(voiceOptions([], 'es', { bookLang:'es' })).toEqual([{ value:'', label:'Automática', hint:'Sin voces' }])
  })
  it('never exposes device or online voices as a fallback for the natural catalogue', () => {
    const voices = system([['n', 'Google español', 'es-ES', 400, { network:true }], ['local', 'Device Spanish', 'es-ES', 500]])
    expect(voiceOptions(voices, 'es', { bookLang:'es' })).toEqual([{ value:'', label:'Automática', hint:'Sin voces' }])
  })
})
