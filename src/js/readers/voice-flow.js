import {readerUI} from './rust-ui-required.js'
import {langBase,declaredLanguage} from './voice-catalog.js'
import {languageOptions,voiceOptions} from './voice-menus.js'
import {neuralVoiceList} from './neural-runtime.js'
const device=()=>navigator.language
export class VoiceFlow{
 constructor(host){this.host=host}
 bookLanguage(){return readerUI().reader_book_language(this.host,device)}
 chooseLanguage(value){return readerUI().reader_choose_language(this.host,value,langBase)}
 voiceBase(voices){return readerUI().reader_voice_base(this.host,voices,langBase,declaredLanguage)}
 populateVoices(){return readerUI().reader_populate_voices(this.host,neuralVoiceList,device,langBase,languageOptions,voiceOptions)}
}
