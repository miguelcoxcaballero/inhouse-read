import {readerUI} from './rust-ui-required.js'
import {normalizeLang} from './voice-catalog.js'
export function detectLanguage(text,fallback='en-US') {
 return readerUI().detect_voice_language(text,fallback,normalizeLang)
}
