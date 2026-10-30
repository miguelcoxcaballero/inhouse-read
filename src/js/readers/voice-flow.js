import {rustMethods} from './rust-ui-required.js'
import * as catalog from './voice-catalog.js'
import * as menus from './voice-menus.js'
import * as runtime from './neural-runtime.js'
// The book's language and the language and voice menus: rust-ui voice_flow.rs, answered by flow_methods.rs.
export class VoiceFlow{constructor(host){this.host=host}}
rustMethods(VoiceFlow,'flow_method','bookLanguage chooseLanguage voiceBase populateVoices',{part:'voices',catalog,menus,runtime,device:()=>navigator.language})
