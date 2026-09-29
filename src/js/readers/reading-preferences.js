export const READING_THEMES = {
  paper: { background:'#faf9f5', color:'#292821' },
  sepia: { background:'#eee0c4', color:'#483825' },
  night: { background:'#191c1a', color:'#d4d8cc' },
  sage: { background:'#dce5d8', color:'#2c3a30' }
}
export const READING_FONTS = {
  book: 'Georgia, "Times New Roman", serif',
  classic: 'Palatino, "Book Antiqua", serif',
  sans: 'Arial, Helvetica, sans-serif',
  mono: 'monospace'
}
export const DEFAULT_READING_PREFERENCES = Object.freeze({
  theme:'paper', font:'book', fontSize:20, lineHeight:1.7, margin:24,
  align:'start', flow:'paginated', pdfMode:'original', zoom:100, rate:1, voice:''
})
export function normalizeReadingPreferences(input = {}) {
  const number = (key, min, max) => Math.min(max, Math.max(min, Number(input[key]) || DEFAULT_READING_PREFERENCES[key]))
  return {
    theme: READING_THEMES[input.theme] ? input.theme : 'paper',
    font: READING_FONTS[input.font] ? input.font : 'book',
    fontSize:number('fontSize',14,36), lineHeight:number('lineHeight',1.2,2.4),
    margin:Math.min(64, Math.max(8, Number(input.margin) || 24)),
    align:input.align === 'justify' ? 'justify' : 'start',
    flow:input.flow === 'scrolled' ? 'scrolled' : 'paginated',
    pdfMode:input.pdfMode === 'text' ? 'text' : 'original',
    zoom:number('zoom',70,200), rate:number('rate',0.5,2), voice:String(input.voice || '')
  }
}
export function readingCSS(preferences) {
  const p = normalizeReadingPreferences(preferences)
  const theme = READING_THEMES[p.theme]
  return `html { color-scheme:${p.theme === 'night' ? 'dark' : 'light'}; background:${theme.background} !important; }
    body { background:${theme.background} !important; color:${theme.color} !important; }
    body, p, li, blockquote, div { font-family:${READING_FONTS[p.font]} !important; font-size:${p.fontSize}px !important; line-height:${p.lineHeight} !important; text-align:${p.align} !important; }
    p, li, span, a, h1, h2, h3, h4 { color:inherit !important; }
    a { text-decoration:underline; } img, svg { max-width:100%; height:auto; }`
}
