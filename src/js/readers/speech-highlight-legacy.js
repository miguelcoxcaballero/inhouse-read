// The sentence being read aloud. Preferred painter: the CSS Custom Highlight
// API (Chromium/Android WebView 105+), which needs no DOM mutation, survives
// pagination and never touches selection, search hits or saved positions. It
// has to be registered in the window that owns the range, so each book iframe
// gets its own <style> with the active theme. Readers fall back to their own
// painter (foliate Overlayer / PDF text-layer class) when it is missing.

export const SPEECH_HIGHLIGHT = 'inhouse-speech'
export const SPEECH_SPAN_CLASS = 'inhouse-speech-current'

// A soft amber wash and nothing else. Judged on real pages (inline markup, links, drop caps, footnote refs, wrapped lines): the thin
// underline that used to come with it doubled up on every link's own underline and ruled a line under each wrapped line, which read
// as busy; the wash alone marks the sentence cleanly and never touches the ink colour, so contrast is the page's own.
// `overlay` is the same colour opaque, for foliate's Overlayer (it paints it at 30% opacity). One entry per READING_THEMES theme.
export const SPEECH_COLORS = {
  paper:{ tint:'rgba(226,166,48,.40)', overlay:'#d9a23a' },
  sepia:{ tint:'rgba(200,108,24,.40)', overlay:'#c4701c' },
  night:{ tint:'rgba(236,184,76,.42)', overlay:'#ecb84c' },
  amoled:{ tint:'rgba(244,192,84,.44)', overlay:'#f4c054' },
  sage:{ tint:'rgba(196,128,24,.38)', overlay:'#be821e' }
}
const colorsFor = theme => SPEECH_COLORS[theme] || SPEECH_COLORS.paper
export const speechOverlayColor = theme => colorsFor(theme).overlay

export function speechCSS(theme) {
  const { tint } = colorsFor(theme)
  return `::highlight(${SPEECH_HIGHLIGHT}) { background-color:${tint}; color:inherit; }
.${SPEECH_SPAN_CLASS} { background-color:${tint}; border-radius:2px; }`
}

/** Idempotent: one <style> per document, restyled when the theme changes. */
export function installSpeechStyle(doc, theme) {
  const parent = doc?.head || doc?.documentElement
  if (!parent) return
  let style = parent.querySelector?.('style[data-inhouse-speech]')
  if (!style) { style = doc.createElement('style'); style.dataset.inhouseSpeech = ''; parent.append(style) }
  const css = speechCSS(theme)
  if (style.textContent !== css) style.textContent = css
}

const registryOf = doc => { const win = doc?.defaultView; return win?.CSS?.highlights && win.Highlight ? { registry:win.CSS.highlights, Highlight:win.Highlight } : null }

export const canPaintHighlights = doc => Boolean(registryOf(doc))

/** Paints `range` (replacing the previous sentence). Returns false when the API is unavailable. */
export function paintSpeechRange(range) {
  const api = registryOf(range?.startContainer?.ownerDocument)
  if (!api) return false
  api.registry.set(SPEECH_HIGHLIGHT, new api.Highlight(range))
  return true
}

export function clearSpeechRange(doc) { registryOf(doc)?.registry.delete(SPEECH_HIGHLIGHT) }
