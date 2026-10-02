export const READING_THEMES = {
  paper: { background:'#faf9f5', color:'#292821', scheme:'light' },
  sepia: { background:'#eee0c4', color:'#483825', scheme:'light' },
  night: { background:'#191c1a', color:'#d4d8cc', scheme:'dark' },
  amoled: { background:'#000000', color:'#c6c6c6', scheme:'dark' },
  sage: { background:'#dce5d8', color:'#2c3a30', scheme:'light' }
}
// The filter each theme puts on an original PDF page (src/css/reading.css,
// `[data-reading-theme] .pdf-page-canvas`). The opening/closing transition
// replays the sepia one on the snapshot so its sepia pages are the reader's.
export const PDF_PAGE_FILTERS = {
  paper: 'none',
  sepia: 'sepia(.5) brightness(.94)',
  night: 'invert(.89) hue-rotate(180deg)',
  amoled: 'grayscale(1) invert(1) brightness(.77647)',
  sage: 'sepia(.25) hue-rotate(45deg) brightness(.94)'
}
export const READING_FONTS = {
  book: 'Georgia, "Times New Roman", serif',
  classic: 'Palatino, "Book Antiqua", serif',
  sans: 'Arial, Helvetica, sans-serif',
  mono: 'monospace'
}
/** The speeds the audiobook offers (a segmented control, not a slider). A saved arbitrary rate moves to the nearest one. */
export const RATE_STEPS = Object.freeze([0.75, 1, 1.25, 1.5, 2])
export const nearestRate = value => {
  const rate = Number(value)
  if (!Number.isFinite(rate) || value === '' || value == null) return 1
  return RATE_STEPS.reduce((best, step) => Math.abs(step - rate) < Math.abs(best - rate) ? step : best)
}
/** '1.25' -> '1,25×' (Spanish decimal comma). */
export const rateLabel = rate => `${String(rate).replace('.', ',')}×`
export const DEFAULT_READING_PREFERENCES = Object.freeze({
  theme:'paper', font:'book', fontSize:20, lineHeight:1.6, margin:16,
  align:'start', flow:'paginated', pdfMode:'original', zoom:100, rate:1, voice:'',
  brightness:100, fontWeight:400, footnotes:false, multilingual:false, skipHeaders:false
})
export function normalizeReadingPreferences(input = {}) {
  if (!input || typeof input !== 'object') input = {}
  const number = (key, min, max) => {
    const value = input[key] == null || input[key] === '' ? NaN : Number(input[key])
    return Math.min(max, Math.max(min, Number.isFinite(value) ? value : DEFAULT_READING_PREFERENCES[key]))
  }
  return {
    theme: Object.hasOwn(READING_THEMES,input.theme) ? input.theme : 'paper',
    font: Object.hasOwn(READING_FONTS,input.font) ? input.font : 'book',
    fontSize:number('fontSize',14,36), lineHeight:number('lineHeight',1.2,2.4),
    margin:number('margin',0,64),
    align:input.align === 'justify' ? 'justify' : 'start',
    flow:input.flow === 'scrolled' ? 'scrolled' : 'paginated',
    pdfMode:input.pdfMode === 'text' ? 'text' : 'original',
    zoom:number('zoom',70,200), rate:nearestRate(input.rate), voice:String(input.voice || ''),
    brightness:number('brightness',50,120), fontWeight:[400,500,600].includes(Number(input.fontWeight)) ? Number(input.fontWeight) : 400,
    footnotes:Boolean(input.footnotes), multilingual:Boolean(input.multilingual), skipHeaders:Boolean(input.skipHeaders)
  }
}
export function readingCSS(preferences) {
  const p = normalizeReadingPreferences(preferences)
  const theme = READING_THEMES[p.theme]
  // --theme-bg-color lets foliate repaint its page backdrop when the theme
  // changes; otherwise it kept the first section's colour (a paper frame
  // around a night page on first open).
  return `html { color-scheme:${theme.scheme}; --theme-bg-color:${theme.background}; background:${theme.background} !important; }
    body { background:${theme.background} !important; color:${theme.color} !important; }
    body, p, li, blockquote, div { font-family:${READING_FONTS[p.font]} !important; font-size:${p.fontSize}px !important; font-weight:${p.fontWeight} !important; line-height:${p.lineHeight} !important; text-align:${p.align} !important; }
    p, li, span, a, h1, h2, h3, h4, h5, h6, blockquote, div, section, article, main, table, td, th, em, strong, small, pre, code { color:inherit !important; }
    ${p.theme === 'amoled' ? 'body :is(p, li, blockquote, div, section, article, main, table, td, th, h1, h2, h3, h4, h5, h6, span, a, em, strong, small, pre, code) { background-color:transparent !important; }' : ''}
    a { text-decoration:underline; } img, svg { max-width:100%; height:auto; }`
}
