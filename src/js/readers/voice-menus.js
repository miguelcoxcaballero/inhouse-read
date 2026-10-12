// Rust owns grouping, stable order, regional scores and duplicate labels.
// Locale display names still come from the same browser ICU-backed helpers.
import {getRustUI} from '../rust-ui.js'
import {normalizeLang,langBase,baseLanguageName,regionName} from './voice-catalog.js'
import * as legacy from './voice-menus-legacy.js'
export const AUTO = ''
const region = tag => normalizeLang(tag).split('-')[1] || ''
export function orderLanguages(bases, {bookLang='',deviceLang=''} = {}) {
  const ui=getRustUI()
  return ui?.order_languages ? ui.order_languages([...bases],langBase(bookLang),langBase(deviceLang),baseLanguageName) : legacy.orderLanguages(bases,{bookLang,deviceLang})
}
export function languageOptions(voices, {bookLang='',deviceLang=''} = {}) {
  const ui=getRustUI()
  return ui?.language_options ? ui.language_options(Array.isArray(voices)?voices:[...(voices||[])],langBase(bookLang),langBase(deviceLang),baseLanguageName(bookLang),baseLanguageName) : legacy.languageOptions(voices,{bookLang,deviceLang})
}
export function voiceOptions(voices, base, {bookLang='',deviceLang=''} = {}) {
  const ui=getRustUI()
  if(!ui?.voice_options) return legacy.voiceOptions(voices,base,{bookLang,deviceLang})
  const language=base||langBase(bookLang), target=language===langBase(bookLang)?bookLang:language, home=langBase(target)
  return ui.voice_options(voices||[],home,region(target),langBase(deviceLang)===home?region(deviceLang):'',regionName)
}
