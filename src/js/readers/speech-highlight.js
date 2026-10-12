import {getRustUI} from '../rust-ui.js'
import * as legacy from './speech-highlight-legacy.js'
export {SPEECH_HIGHLIGHT,SPEECH_SPAN_CLASS,SPEECH_COLORS} from './speech-highlight-legacy.js'
export const speechOverlayColor=theme=>getRustUI()?.speech_overlay?.(String(theme))??legacy.speechOverlayColor(theme)
export const speechCSS=theme=>getRustUI()?.speech_css?.(String(theme))??legacy.speechCSS(theme)
export function installSpeechStyle(doc,theme){const ui=getRustUI();if(ui?.speech_style)ui.speech_style(doc,String(theme));else legacy.installSpeechStyle(doc,theme)}
export const canPaintHighlights=doc=>getRustUI()?.speech_can_paint?.(doc)??legacy.canPaintHighlights(doc)
export const paintSpeechRange=range=>getRustUI()?.speech_paint?.(range)??legacy.paintSpeechRange(range)
export function clearSpeechRange(doc){const ui=getRustUI();if(ui?.speech_clear)ui.speech_clear(doc);else legacy.clearSpeechRange(doc)}
