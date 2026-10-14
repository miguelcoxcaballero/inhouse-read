import {readerUI} from './rust-ui-required.js'

// The sentence being read aloud is painted with the CSS Custom Highlight API when
// the window has it (no DOM mutation, selection or saved position is touched);
// the readers fall back to their own painter otherwise. Rust owns the theme
// colours, the per-document <style> and the registry calls.
export const SPEECH_HIGHLIGHT = 'inhouse-speech'
export const SPEECH_SPAN_CLASS = 'inhouse-speech-current'
export const speechOverlayColor=theme=>readerUI().speech_overlay(String(theme))
export const speechCSS=theme=>readerUI().speech_css(String(theme))
export function installSpeechStyle(doc,theme){readerUI().speech_style(doc,String(theme))}
export const canPaintHighlights=doc=>readerUI().speech_can_paint(doc)
export const paintSpeechRange=range=>readerUI().speech_paint(range)
export function clearSpeechRange(doc){readerUI().speech_clear(doc)}
