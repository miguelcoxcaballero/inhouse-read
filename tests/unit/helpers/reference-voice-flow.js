import {declaredLanguage,langBase} from '../../../src/js/readers/voice-catalog.js'
import {AUTO,languageOptions,voiceOptions} from './reference-voice-menus.js'
import {neuralVoiceList} from '../../../src/js/readers/neural-runtime.js'
export class LegacyVoiceFlow{
  bookLanguage() {
    let bookLang = ''
    try { bookLang = this.reader.language || '' } catch { /* no book open yet */ }
    return bookLang || navigator.language || ''
  }
  chooseLanguage(value) {
    const voices = this.voiceCatalog?.voices || []
    const base = value || langBase(this.bookLanguage())
    const keep = voices.some(voice => voice.id === this.preferences.voice && voice.installed && voice.base === base)
    if (!keep && this.preferences.voice) this.setPreference('voice', '', { restart:false })
    this.setPreference('voiceLang', value)
    this.populateVoices()
  }
  /** The language whose voices the second dropdown lists: the one picked, else the one of the voice in use, else the book's. */
  voiceBase(voices) {
    const book = langBase(this.bookLanguage()), { voice: id, voiceLang } = this.preferences
    if (voiceLang) return voiceLang
    const chosen = id && voices.find(voice => voice.id === id && voice.installed)
    const declared = declaredLanguage(this.reader)
    if (chosen && !(chosen.neural && declared && chosen.base !== langBase(declared))) return chosen.base
    return book
  }
  populateVoices() {
    const voices = neuralVoiceList()
    const bookLang = this.bookLanguage(), deviceLang = navigator.language
    const requestedBase = this.voiceBase(voices), bookBase = langBase(bookLang)
    const base = voices.some(voice => voice.base === requestedBase) ? requestedBase : ''
    this.voiceBaseShown = base
    const languages = languageOptions(voices, { bookLang, deviceLang })
    const pickedLanguage = this.preferences.voiceLang || (base && base !== bookBase ? base : AUTO)
    this.languageMenu.setOptions(languages, pickedLanguage)
    this.languageMenu.setValueText(pickedLanguage === AUTO ? `Automática · ${languages[0].hint}` : '')
    const options = voiceOptions(voices, base, { bookLang, deviceLang })
    const saved = options.some(option => option.value === this.preferences.voice) ? this.preferences.voice : AUTO // a voice that is gone falls back to Automática
    this.voiceMenu.setOptions(options, saved)
    this.voiceMenu.setValueText(saved === AUTO ? (options.length > 1 ? `Automática · ${options[0].hint}` : 'Sin voces instaladas') : '')
    this.voiceCatalog = { voices, bookLang }
    this.neuralPicker?.render()
  }
}
