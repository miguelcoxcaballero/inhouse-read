// The sentence being read aloud. Preferred painter: the CSS Custom Highlight
// API (Chromium/Android WebView 105+), which needs no DOM mutation, survives
// pagination and never touches selection, search hits or saved positions. It
// has to be registered in the window that owns the range, so each book iframe
// gets its own <style> with the active theme. Readers fall back to their own
// painter (foliate Overlayer / PDF text-layer class) when it is missing.

export const SPEECH_HIGHLIGHT = 'inhouse-speech'
export const SPEECH_SPAN_CLASS = 'inhouse-speech-current'

// A soft amber wash plus a thin underline: legible without hiding the text on
// the four reading themes. Alpha is kept low on dark pages so ink stays crisp.
export const SPEECH_COLORS = {
  paper:{ tint:'rgba(217,162,58,.36)', line:'rgba(160,100,10,.75)' },
  sepia:{ tint:'rgba(196,112,28,.30)', line:'rgba(130,70,10,.75)' },
  night:{ tint:'rgba(232,184,84,.30)', line:'rgba(240,200,110,.8)' },
  amoled:{ tint:'rgba(240,190,90,.30)', line:'rgba(245,205,120,.85)' },
  sage:{ tint:'rgba(190,130,30,.30)', line:'rgba(120,80,10,.75)' }
}
const colorsFor = theme => SPEECH_COLORS[theme] || SPEECH_COLORS.paper

export function speechCSS(theme) {
  const { tint, line } = colorsFor(theme)
  return `::highlight(${SPEECH_HIGHLIGHT}) { background-color:${tint}; color:inherit; text-decoration:underline; text-decoration-color:${line}; text-decoration-thickness:1px; text-underline-offset:3px; }
.${SPEECH_SPAN_CLASS} { background-color:${tint}; border-radius:2px; box-shadow:0 1px 0 ${line}; }`
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
