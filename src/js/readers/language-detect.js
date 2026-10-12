import {getRustUI} from '../rust-ui.js'
import {normalizeLang} from './voice-catalog.js'
import {detectLanguage as legacy} from './language-detect-legacy.js'
export function detectLanguage(text,fallback='en-US') {
 const ui=getRustUI()
 return ui?.detect_voice_language ? ui.detect_voice_language(text,fallback,normalizeLang) : legacy(text,fallback)
}
