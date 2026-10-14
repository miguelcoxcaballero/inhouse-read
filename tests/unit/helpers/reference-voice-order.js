import {PRIORITY_LANGUAGES,langBase,normalizeLang,languageName} from './reference-voice-catalog.js'
const langRegion=tag=>normalizeLang(tag).split('-')[1]||''
export function orderNeuralVoices(neuralVoices, { bookLang = '', deviceLang = '' } = {}) {
  const bookBase = langBase(bookLang), deviceBase = langBase(deviceLang), bookRegion = langRegion(bookLang)
  const rank = voice => voice.base === bookBase ? 0 : voice.base === deviceBase ? 1 : 2 + (PRIORITY_LANGUAGES.includes(voice.base) ? PRIORITY_LANGUAGES.indexOf(voice.base) : PRIORITY_LANGUAGES.length)
  const near = voice => voice.base === bookBase && bookRegion && voice.region === bookRegion ? 0 : 1
  return [...(neuralVoices || [])].filter(voice => voice?.neural).sort((a, b) => rank(a) - rank(b)
    || (rank(a) > 2 ? languageName(a.base).localeCompare(languageName(b.base), 'es') : 0)
    || near(a) - near(b) || Number(b.recommended) - Number(a.recommended) || Number(b.tier === 'high') - Number(a.tier === 'high') || a.name.localeCompare(b.name, 'es') || a.id.localeCompare(b.id))
}
export const recommendedNeuralFor = (neuralVoices, lang, deviceLang = '') => orderNeuralVoices(neuralVoices, { bookLang:lang, deviceLang }).find(voice => voice.base === langBase(lang)) || null
