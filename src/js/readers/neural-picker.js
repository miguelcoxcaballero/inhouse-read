// The "Voces naturales" part of the audio panel: the list of downloadable on-device voices (Descargar /
// progress and Cancelar / Instalada, Usar and Quitar / error and Reintentar), the warning shown
// when the neural voice was given up on, and the first-use offer row. It talks to the engine only through
// neural-runtime.js, never downloads by itself, and stays hidden where the engine is unsupported or failed to load.
// Its states, rows, offer, downloads and warm-up are rust-ui (picker_*, RustNeuralView); these methods hand Rust the
// picker and the engine, storage, idle and frame doorways. The frozen originals are tests/unit/helpers/reference-picker-*.js.
import { readerUI, rustMethods } from './rust-ui-required.js'
import * as runtime from './neural-runtime.js'
import {loadNeural,neuralEngine,neuralVoiceList} from './neural-runtime.js'
import * as catalog from './voice-catalog.js'
import {declaredLanguage,isNeuralId,langBase,languageName,orderNeuralVoices,recommendedNeuralFor} from './voice-catalog.js'

// Texts of the natural-voice list that the Rust picker receives as plain data.
const DOWNLOAD_ERRORS={offline:'Sin conexión.',storage:'Sin espacio en el dispositivo.',default:'No se pudo descargar.'}
const WARNINGS={
  'not-installed':'La voz natural seleccionada no está instalada. Descárgala de nuevo.',
  default:'No se pudo iniciar la voz natural. Pulsa Reintentar para volver a usarla.'
}
// 'Ahora no' means not now: the offer comes back for that language after a while (Rust keeps the dates).
const OFFER='inhouse-read-neural-offer-dismissed',USED='inhouse-read-neural-used'
const readOffer=()=>localStorage.getItem(OFFER),writeOffer=value=>localStorage.setItem(OFFER,value),now=()=>Date.now()
const readUsed=()=>localStorage.getItem(USED),writeUsed=()=>localStorage.setItem(USED,'1')
const ignore=value=>Promise.resolve(value).catch(()=>{})
const kit={runtime,catalog,messages:DOWNLOAD_ERRORS,readOffer,writeOffer,now,readUsed,ignore,
 get clearTimeout(){return clearTimeout},get cancelIdle(){return typeof cancelIdleCallback==='function'?cancelIdleCallback:null},get device(){return navigator.language},
 schedule:(ui,owner,context)=>{const run=()=>ui.picker_warm_fire(owner,context);return typeof requestIdleCallback==='function'?{idle:true,id:requestIdleCallback(run,{timeout:2500})}:{idle:false,id:setTimeout(run,800)}},
 load:(ui,owner,context,value)=>loadNeural().then(()=>ui.picker_loaded(owner,context,value),()=>{}),
 listen:(ui,owner,engine)=>{engine.addEventListener('change',()=>owner.changed());engine.addEventListener('status',()=>ui.picker_engine_status(owner,engine,writeUsed))},
 engineRefresh:(ui,owner,engine,context,value)=>Promise.resolve(engine.refresh?.()).catch(()=>{}).then(()=>ui.picker_engine_refreshed(owner,context,value)),
 warmActive:(owner,context)=>()=>owner.isWarmCurrent(context),frame:(ui,owner)=>requestAnimationFrame(()=>ui.picker_paint_frame(owner))}
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
    this.host = host
    this.tasks = new Map() // voice id -> AbortController of the download this page started
    this.errors = new Map() // voice id -> message of the last failed download
    this.engine = null; this.signature = ''; this.frame = 0
    this.warmGeneration = 0; this.warmHandle = null
    const panel = host.panel
    this.view = new (readerUI().RustNeuralView)(panel)
    this.block = panel.querySelector('[data-neural]')
    this.offer = panel.querySelector('[data-neural-offer]')
    for (const root of [this.block, this.offer]) root.addEventListener('click', event => this.click(event))
    panel.querySelector('[data-neural-retry]').addEventListener('click', () => { host.voice.retryNeural?.(); host.voice.play?.(); this.render() })
  }
  patchProgress(engine){return pickerView(this).patchPickerProgress(this,engine)}
  get bookLang() { return this.host.bookLanguage() }
  announce(text) { this.host.panel.querySelector('[data-neural-status]').textContent = text }

  render(){return pickerView(this).renderPicker(this)}
  row(engine,voice){return pickerView(this).pickerRow(this,engine,voice)}

  // --- Actions ------------------------------------------------------------------------------------------------------
  /** Downloads a voice (only ever called by a tap) and selects it when it is ready. */
  async install(id){
    const ui=readerUI(),context=ui.picker_install_begin(this,id,neuralEngine,isNeuralId,()=>new AbortController());if(!context)return
    try{await context.task;ui.picker_install_done(this,id,context,declaredLanguage,langBase,neuralVoiceList)}catch(error){ui.picker_install_error(this,id,context,error,DOWNLOAD_ERRORS)}
  }
  async remove(id){
    const ui=readerUI(),context=ui.picker_remove_begin(this,id,neuralEngine,neuralVoiceList);if(!context)return
    try{await context.engine.remove(id)}catch{}
    ui.picker_remove_done(this,id,context)
  }

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
