import { describe, expect, it } from 'vitest'
import { normalizeNeuralVoice, normalizeVoices } from '../../src/js/readers/voice-catalog.js'
import { languageOptions, orderLanguages, voiceOptions } from '../../src/js/readers/voice-menus.js'

const system = list => normalizeVoices(list.map(([voiceURI, name, lang, quality = 400, extra = {}]) => ({ voiceURI, name, lang, quality, network:false, installed:true, ...extra })))
const neural = (piperId, lang, name, installed = false) => normalizeNeuralVoice({ id:`piper:${piperId}`, piperId, lang, name, quality:'medium', sizeMB:63 }, installed ? [`piper:${piperId}`] : [])

describe('language dropdown', () => {
  it('orders the book language, the device language, the usual ones, then the rest A-Z', () => {
    expect(orderLanguages(['ru', 'fr', 'en', 'es', 'ar', 'de'], { bookLang:'fr-FR', deviceLang:'es-ES' })).toEqual(['fr', 'es', 'en', 'de', 'ar', 'ru'])
  })
  it('starts with Automática (the book language) and lists a language per voice found, with a count or "Por descargar"', () => {
    const voices = [...system([['es1', 'Helena', 'es-ES'], ['es2', 'Pablo', 'es-ES'], ['en1', 'George', 'en-GB']]), neural('fr_FR-siwis-medium', 'fr-FR', 'Siwis'), neural('en_US-lessac-medium', 'en-US', 'Lessac', true)]
    expect(languageOptions(voices, { bookLang:'es', deviceLang:'en-US' })).toEqual([
      { value:'', label:'Automática', hint:'Español' },
      { value:'es', label:'Español', hint:'2 voces' },
      { value:'en', label:'Inglés', hint:'2 voces' },
      { value:'fr', label:'Francés', hint:'Por descargar' }
    ])
  })
  it('does not list a language without a voice that is ready or can be downloaded', () => {
    const voices = system([['xx', 'Ghost', 'es-ES', 400, { installed:false }]])
    expect(languageOptions(voices, { bookLang:'es' }).map(option => option.value)).toEqual([''])
  })
})

describe('voice dropdown', () => {
  it('lists Automática and the usable voices of the language, best first, naming the one Automática would use', () => {
    const voices = system([['a', 'Microsoft Helena - Spanish (Spain)', 'es-ES', 300], ['b', 'Google español', 'es-ES', 500], ['c', 'George', 'en-GB']])
    const options = voiceOptions(voices, 'es', { bookLang:'es' })
    expect(options.map(option => option.value)).toEqual(['', 'b', 'a'])
    expect(options[0]).toMatchObject({ label:'Automática', hint:options[1].label })
  })
  it('gives equal names a number so no two rows look alike, and names voices without a title by their region', () => {
    const voices = system([['a', 'es-es-x-eed-local', 'es-ES', 400], ['b', 'es-es-x-eef-local', 'es-ES', 400], ['c', 'es-mx-x-abc-local', 'es-MX', 300]])
    const labels = voiceOptions(voices, 'es', { bookLang:'es' }).slice(1).map(option => option.label)
    expect(labels).toEqual(['España 1', 'España 2', 'México'])
  })
  it('lists installed natural voices (not the ones to download) and says so when no voice is there', () => {
    const voices = [neural('es_MX-claude-high', 'es-MX', 'Claude', true), neural('es_ES-davefx-medium', 'es-ES', 'Davefx')]
    const options = voiceOptions(voices, 'es', { bookLang:'es' })
    expect(options.map(option => option.value)).toEqual(['', 'piper:es_MX-claude-high'])
    expect(options[1]).toMatchObject({ label:'Claude', hint:'México · Natural' })
    expect(voiceOptions([], 'es', { bookLang:'es' })).toEqual([{ value:'', label:'Automática', hint:'Sin voces' }])
  })
  it('flags online voices', () => {
    const voices = system([['n', 'Google español', 'es-ES', 400, { network:true }]])
    expect(voiceOptions(voices, 'es', { bookLang:'es' })[1].hint).toContain('Requiere internet')
  })
})
