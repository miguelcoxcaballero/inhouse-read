// The "Voces naturales" part of the audio panel: the list of downloadable on-device voices (Descargar /
// progress and Cancelar / Instalada, Usar and Quitar / error and Reintentar), the warning shown
// when the neural voice was given up on, and the first-use offer row. It talks to the engine only through
// neural-runtime.js, never downloads by itself, and stays hidden where the engine is unsupported or failed to load.
// Its states, rows, offer, downloads and warm-up are rust-ui (picker_*, RustNeuralView); these methods hand Rust the
// picker and the engine, storage, idle and frame doorways. The frozen originals are tests/unit/helpers/reference-picker-*.js.
import { readerUI, rustMethods } from './rust-ui-required.js'
import * as runtime from './neural-runtime.js'
import {neuralEngine,neuralVoiceList} from './neural-runtime.js'
import * as catalog from './voice-catalog.js'
import {langBase,languageName,orderNeuralVoices,recommendedNeuralFor} from './voice-catalog.js'

// Texts of the natural-voice list that the Rust picker receives as plain data.
const DOWNLOAD_ERRORS={offline:'Sin conexión.',storage:'Sin espacio en el dispositivo.',default:'No se pudo descargar.'}
const WARNINGS={
  'not-installed':'La voz natural seleccionada no está instalada. Descárgala de nuevo.',
  default:'No se pudo iniciar la voz natural. Pulsa Reintentar para volver a usarla.'
}
// The engine and catalogue modules and the texts of a failed download; the schedulers, the engine's listeners and
// the storage of 'Ahora no' and of the first use are rust-ui picker_shell.rs.
const kit={runtime,catalog,messages:DOWNLOAD_ERRORS}
const services={engine:neuralEngine,list:neuralVoiceList,order:(list,bookLang,deviceLang)=>orderNeuralVoices(list,{bookLang,deviceLang}),language:languageName,
 url:path=>new URL(path,new URL(import.meta.env?.BASE_URL||'/',location.href)).href,base:langBase,recommend:recommendedNeuralFor,
 cancel:handle=>cancelAnimationFrame(handle),device:()=>navigator.language,messages:DOWNLOAD_ERRORS,warnings:WARNINGS}
// The view owns no event listeners; the picker created it from the panel and hands it these services once.
const configured=new WeakSet()
function pickerView(host){
 const current=host.view
 if(!configured.has(current)){current.configurePicker(services);configured.add(current)}
 return current
}

export class NeuralVoicePicker {
  /** `host` is the ReaderExperience: panel, voice (ReadingVoice), preferences, setPreference() and populateVoices(). */
  constructor(host) {
    // Its state, the view and the click listeners of the list, the offer and Reintentar: rust-ui picker_shell.rs.
    const ui = readerUI()
    ui.picker_construct(this, host, ui)
  }
  patchProgress(engine){return pickerView(this).patchPickerProgress(this,engine)}
  get bookLang() { return this.host.bookLanguage() }
  announce(text) { this.host.panel.querySelector('[data-neural-status]').textContent = text }

  render(){return pickerView(this).renderPicker(this)}
  row(engine,voice){return pickerView(this).pickerRow(this,engine,voice)}

  // --- Keyboard focus survives a repaint ---------------------------------------------------------------------------------
  focusKey() { return this.view.focusKey() }
  restoreFocus(key) { this.view.restoreFocus(key) }
}
// warm schedules the engine module for an idle moment once a book opens (nothing loads at app start); refresh
// re-reads what is installed when the audio tab opens; warmUp loads the model of the voice the next Play uses, so the
// tap does not pay the 3-6 s cold start; changed rebuilds the voice list when the installed set changes, paint only
// patches download progress in place (a rebuilt row under the finger made Cancelar miss); cancel aborts a download
// through the engine (speakers of one model share it); snoozed holds 'Ahora no' for a while per language; offerFor
// offers a download when no installed natural voice speaks the book's language.
rustMethods(NeuralVoicePicker,'picker_method',`warm refresh used attach warmContext isWarmCurrent cancelWarm warmUp changed paint state
 click cancel voiceName use dismissed snoozed dismiss offerFor renderOffer`,kit)
// install downloads a voice (only ever called by a tap) and selects it when it is ready; remove deletes one: rust-ui
// picker_member (picker_members.rs), which answers with the promise Rust returns.
rustMethods(NeuralVoicePicker,'picker_member','!install !remove',kit)
