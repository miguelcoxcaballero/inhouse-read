import { isNeuralVoiceId, neuralVoices } from './neural-voice/catalog.js'
import { langBase } from './voice-catalog.js'
import {rustNearestRate,rustReadingNumbers,rustReadingCSS} from './reading-preferences-wasm.js'
import {getRustUI} from '../rust-ui.js'
import {getRustShelf} from '../rust-shelf.js'

import {READING_THEMES,PDF_PAGE_FILTERS,READING_FONTS} from './reading-palette.js'
export {READING_THEMES,PDF_PAGE_FILTERS,READING_FONTS}

/** Saved arbitrary speeds move to the nearest of the audiobook's five choices. */
export const RATE_STEPS = Object.freeze([0.75, 1, 1.25, 1.5, 2])
// Merely observe modules already owned by the app. Saved preferences can be
// inspected before either module exists, without loading the reader or voice.
const policy = () => getRustUI() || getRustShelf()
const host = {themes:READING_THEMES,fonts:READING_FONTS,voices:neuralVoices,langBase,isVoice:isNeuralVoiceId,numbers:rustReadingNumbers}
const nativeStyles = new WeakMap()
export const nearestRate = value => {
  const native = policy()
  if (native?.reading_preferences_rate) return native.reading_preferences_rate(value)
  const rate = Number(value)
  if (!Number.isFinite(rate) || value === '' || value == null) return 1
  const normalized=rustNearestRate(rate)
  if(normalized!==undefined)return normalized
  return RATE_STEPS.reduce((best, step) => Math.abs(step - rate) < Math.abs(best - rate) ? step : best)
}
export const rateLabel = rate => {
  const native = policy()
  return native?.reading_preferences_rate_label ? native.reading_preferences_rate_label(rate) : `${String(rate).replace('.', ',')}×`
}
export const DEFAULT_READING_PREFERENCES = Object.freeze({
  theme:'paper', font:'book', fontSize:20, lineHeight:1.6, margin:16,
  align:'start', flow:'paginated', pdfMode:'original', zoom:100, rate:1, voice:'', voiceLang:'',
  brightness:100, fontWeight:400, footnotes:false, multilingual:false, skipHeaders:false
})
export function normalizeReadingPreferences(input = {}) {
  const native = policy()
  if (native?.reading_preferences_normalize) return native.reading_preferences_normalize(input, host)
  if (!input || typeof input !== 'object') input = {}
  const voice = String(input.voice || ''), voiceLang = langBase(input.voiceLang)
  const numbers=rustReadingNumbers(input)
  const number = (key, min, max) => {
    const value = input[key] == null || input[key] === '' ? NaN : Number(input[key])
    return Math.min(max, Math.max(min, Number.isFinite(value) ? value : DEFAULT_READING_PREFERENCES[key]))
  }
  return {
    theme: Object.hasOwn(READING_THEMES,input.theme) ? input.theme : 'paper',
    font: Object.hasOwn(READING_FONTS,input.font) ? input.font : 'book',
    fontSize:numbers?.[0]??number('fontSize',14,36), lineHeight:numbers?.[1]??number('lineHeight',1.2,2.4),
    margin:numbers?.[2]??number('margin',0,64),
    align:input.align === 'justify' ? 'justify' : 'start',
    flow:input.flow === 'scrolled' ? 'scrolled' : 'paginated',
    pdfMode:input.pdfMode === 'text' ? 'text' : 'original',
    zoom:numbers?.[3]??number('zoom',70,200), rate:numbers?.[4]??nearestRate(input.rate),
    voice:isNeuralVoiceId(voice) && neuralVoices.some(entry => entry.id === voice) ? voice : '',
    voiceLang:voiceLang && neuralVoices.some(entry => langBase(entry.lang) === voiceLang) ? voiceLang : '',
    brightness:numbers?.[5]??number('brightness',50,120), fontWeight:numbers?.[6]??([400,500,600].includes(Number(input.fontWeight)) ? Number(input.fontWeight) : 400),
    footnotes:Boolean(input.footnotes), multilingual:Boolean(input.multilingual), skipHeaders:Boolean(input.skipHeaders)
  }
}
export function readingCSS(preferences) {
  const native = policy()
  if (native?.reading_preferences_css) {
    let cache = nativeStyles.get(native)
    if (!cache) { cache = new Map(); nativeStyles.set(native, cache) }
    return native.reading_preferences_css(preferences, host, cache)
  }
  const p = normalizeReadingPreferences(preferences)
  const css=rustReadingCSS(p)
  if(css!==null)return css
  const theme = READING_THEMES[p.theme]
  // --theme-bg-color lets foliate repaint its page backdrop when the theme
  // changes; otherwise it kept the first section's colour (a paper frame
  // around a night page on first open).
  return `html { -webkit-text-size-adjust:100%; text-size-adjust:100%; color-scheme:${theme.scheme}; --theme-bg-color:${theme.background}; background:${theme.background} !important; }
    body { background:${theme.background} !important; color:${theme.color} !important; }
    body, p, li, blockquote, div { font-family:${READING_FONTS[p.font]} !important; font-size:${p.fontSize}px !important; font-weight:${p.fontWeight} !important; line-height:${p.lineHeight} !important; text-align:${p.align} !important; }
    p, li, span, a, h1, h2, h3, h4, h5, h6, blockquote, div, section, article, main, table, td, th, em, strong, small, pre, code { color:inherit !important; }
    ${p.theme === 'amoled' ? 'body :is(p, li, blockquote, div, section, article, main, table, td, th, h1, h2, h3, h4, h5, h6, span, a, em, strong, small, pre, code) { background-color:transparent !important; }' : ''}
    a { text-decoration:underline; } img, svg { max-width:100%; height:auto; }`
}
