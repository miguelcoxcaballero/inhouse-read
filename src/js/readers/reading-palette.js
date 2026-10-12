// Static appearance data: safe to inspect before browser WASM is compiled.
export const READING_THEMES = {
  paper: { background:'#faf9f5', color:'#292821', scheme:'light' },
  sepia: { background:'#eee0c4', color:'#483825', scheme:'light' },
  night: { background:'#191c1a', color:'#d4d8cc', scheme:'dark' },
  amoled: { background:'#000000', color:'#c6c6c6', scheme:'dark' },
  sage: { background:'#dce5d8', color:'#2c3a30', scheme:'light' }
}
// Applied only to printed paper/ink by pdf-page-theme.js. Embedded images are
// restored from the original render; never apply these filters to the DOM page.
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
