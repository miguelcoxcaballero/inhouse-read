// What the two dropdowns of the audio panel list: first the language, then the voices of that language.
// Pure functions over the normalised voices of voice-catalog.js (system voices + the neural catalogue, installed or not).
import { PRIORITY_LANGUAGES, baseLanguageName, langBase, rankedVoicesFor, regionName, voiceTitle } from './voice-catalog.js'

/** Value of the "follow the book" choice in both dropdowns. */
export const AUTO = ''

/** Language bases ordered as the picker lists them: the book's, the device's, es/en/fr/de/it/pt/ca, then the rest A-Z. */
export function orderLanguages(bases, { bookLang = '', deviceLang = '' } = {}) {
  const book = langBase(bookLang), device = langBase(deviceLang)
  const rank = base => base === book ? 0 : base === device ? 1 : PRIORITY_LANGUAGES.includes(base) ? 2 + PRIORITY_LANGUAGES.indexOf(base) : 100
  return [...bases].sort((a, b) => rank(a) - rank(b) || baseLanguageName(a).localeCompare(baseLanguageName(b), 'es'))
}

/**
 * Options of the language dropdown: "Automática" (the language of the book) and one per language with a voice to use or
 * to download. `hint` says what is there: how many voices are ready, or that natural ones can be downloaded.
 */
export function languageOptions(voices, { bookLang = '', deviceLang = '' } = {}) {
  const byBase = new Map()
  for (const voice of voices || []) {
    if (!voice?.base) continue
    const entry = byBase.get(voice.base) || { ready:0, download:0 }
    if (voice.installed) entry.ready++; else if (voice.neural) entry.download++
    byBase.set(voice.base, entry)
  }
  const options = [{ value:AUTO, label:'Automática', hint:baseLanguageName(bookLang) }]
  for (const base of orderLanguages([...byBase.keys()], { bookLang, deviceLang })) {
    const { ready, download } = byBase.get(base)
    if (!ready && !download) continue
    options.push({ value:base, label:baseLanguageName(base), hint:ready ? (ready === 1 ? '1 voz' : `${ready} voces`) : 'Por descargar' })
  }
  return options
}

/** Short name of a system voice: the person's name when the device gives one ("Helena"), otherwise its region ("España"). */
function systemName(voice) {
  return voiceTitle(voice) || regionName(voice.lang) || baseLanguageName(voice.lang)
}
const qualityHint = voice => voice.neural ? 'Natural' : voice.quality === null ? '' : voice.quality >= 400 ? 'Alta calidad' : voice.quality >= 300 ? 'Calidad normal' : 'Calidad básica'

/**
 * Options of the voice dropdown for one language. "Automática" comes first and names the voice it would pick; then the
 * voices that can speak right now, best first. Equal names get a number so no two rows look the same. Natural voices
 * that still have to be downloaded are not here: the dropdown shows them apart, with their download buttons.
 */
export function voiceOptions(voices, base, { bookLang = '', deviceLang = '' } = {}) {
  const language = base || langBase(bookLang)
  const ranked = rankedVoicesFor(voices || [], language === langBase(bookLang) ? bookLang : language, deviceLang)
  const seen = new Map()
  const rows = ranked.map(voice => {
    const title = voice.neural ? voice.name : systemName(voice)
    const count = (seen.get(title) || 0) + 1
    seen.set(title, count)
    const where = voice.neural || voiceTitle(voice) ? regionName(voice.lang) : ''
    const hint = [where, qualityHint(voice), voice.network ? 'Requiere internet' : ''].filter(Boolean).join(' · ')
    return { value:voice.id, label:count > 1 ? `${title} ${count}` : title, hint, voice }
  })
  // The first row of a name that turned out to repeat gets its number too, so "Voz" and "Voz 2" never appear together.
  for (const row of rows) { const title = row.voice.neural ? row.voice.name : systemName(row.voice); if (seen.get(title) > 1 && row.label === title) row.label = `${title} 1` }
  const best = ranked[0]
  return [{ value:AUTO, label:'Automática', hint:best ? rows[0].label : 'Sin voces' }, ...rows]
}
