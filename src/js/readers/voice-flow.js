import {getRustUI} from '../rust-ui.js'
import {langBase,declaredLanguage} from './voice-catalog.js'
import {languageOptions,voiceOptions} from './voice-menus.js'
import {neuralVoiceList} from './neural-runtime.js'
import {LegacyVoiceFlow} from './voice-flow-legacy.js'
const legacy=LegacyVoiceFlow.prototype
const device=()=>navigator.language
export class VoiceFlow{
 constructor(host){this.host=host}
 bookLanguage(){const ui=getRustUI();return ui?.reader_book_language?ui.reader_book_language(this.host,device):legacy.bookLanguage.call(this.host)}
 chooseLanguage(value){const ui=getRustUI();return ui?.reader_choose_language?ui.reader_choose_language(this.host,value,langBase):legacy.chooseLanguage.call(this.host,value)}
 voiceBase(voices){const ui=getRustUI();return ui?.reader_voice_base?ui.reader_voice_base(this.host,voices,langBase,declaredLanguage):legacy.voiceBase.call(this.host,voices)}
 populateVoices(){const ui=getRustUI();return ui?.reader_populate_voices?ui.reader_populate_voices(this.host,neuralVoiceList,device,langBase,languageOptions,voiceOptions):legacy.populateVoices.call(this.host)}
}
