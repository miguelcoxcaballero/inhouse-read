// Test harness: the argument preparation of the voice menus as src/js/readers held it; the reader runs rust-ui voice_menus.rs.
// Rust owns grouping, stable order, regional scores and duplicate labels.
// Locale display names still come from the same browser ICU-backed helpers.
import {readerUI} from '../../../src/js/readers/rust-ui-required.js'
import {normalizeLang,langBase,baseLanguageName,regionName} from '../../../src/js/readers/voice-catalog.js'
export const AUTO = ''
const region = tag => normalizeLang(tag).split('-')[1] || ''
export function orderLanguages(bases, {bookLang='',deviceLang=''} = {}) {
  return readerUI().order_languages([...bases],langBase(bookLang),langBase(deviceLang),baseLanguageName)
}
export function languageOptions(voices, {bookLang='',deviceLang=''} = {}) {
  return readerUI().language_options(Array.isArray(voices)?voices:[...(voices||[])],langBase(bookLang),langBase(deviceLang),baseLanguageName(bookLang),baseLanguageName)
}
export function voiceOptions(voices, base, {bookLang='',deviceLang=''} = {}) {
  const language=base||langBase(bookLang), target=language===langBase(bookLang)?bookLang:language, home=langBase(target)
  return readerUI().voice_options(voices||[],home,region(target),langBase(deviceLang)===home?region(deviceLang):'',regionName)
}
