// The "Voces naturales" part of the audio panel: the list of downloadable on-device voices (Descargar /
// progress and Cancelar / Instalada, Usar and Quitar / error and Reintentar), the warning shown
// when the neural voice was given up on, and the first-use offer row. It talks to the engine only through
// neural-runtime.js, never downloads by itself, and stays hidden where the engine is unsupported or failed to load.
// Its states, rows, offer, downloads and warm-up are rust-ui (picker_*, RustNeuralView); these methods hand Rust the
// picker and the engine, storage, idle and frame doorways. The frozen originals are tests/unit/helpers/reference-picker-*.js.
import { readerUI } from './rust-ui-required.js'
import {loadNeural,neuralEngine,neuralVoiceList} from './neural-runtime.js'
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
  /** Nothing loads at app start: a book being opened schedules the engine module for an idle moment, ready before Play is tapped. */
  warm(){
    const ui=readerUI()
    return ui.picker_warm(this,(owner,context)=>{const run=()=>ui.picker_warm_fire(owner,context);return typeof requestIdleCallback==='function'?{idle:true,id:requestIdleCallback(run,{timeout:2500})}:{idle:false,id:setTimeout(run,800)}})
  }
  /** (Re)loads the engine module if it is not there yet and re-reads what is installed. Cheap; called when the audio tab opens. */
  refresh({warm=true}={}){const ui=readerUI();return ui.picker_refresh(this,warm,(owner,context,value)=>loadNeural().then(()=>ui.picker_loaded(owner,context,value),()=>{}))}
  used(){return readerUI().picker_used(readUsed)}
  attach(warm=true){
    const ui=readerUI()
    return ui.picker_attach(this,warm,neuralEngine,(owner,engine)=>{engine.addEventListener('change',()=>owner.changed());engine.addEventListener('status',()=>ui.picker_engine_status(owner,engine,writeUsed))},
      (owner,engine,context,value)=>Promise.resolve(engine.refresh?.()).catch(()=>{}).then(()=>ui.picker_engine_refreshed(owner,context,value)))
  }
  /**
   * Starts the engine's worker and loads the model of the voice the next Play will use, so the tap does not pay the cold start
   * (3-6 s). The engine tears it down by itself after ~90 s without speech. Does nothing unless that voice is a downloaded neural one.
   */
  warmContext(){return readerUI().picker_warm_context(this)}
  isWarmCurrent(context){return readerUI().picker_warm_current(this,context)}
  cancelWarm(){return readerUI().picker_cancel_warm(this,typeof cancelIdleCallback==='function'?cancelIdleCallback:null,clearTimeout)}
  warmUp(){return readerUI().picker_warm_up(this,neuralEngine,ignore,(owner,context)=>()=>owner.isWarmCurrent(context))}
  /** Installed set changes rebuild the voice select too; download progress only repaints this block. */
  changed(){const ui=readerUI();return ui.picker_changed(this,neuralEngine,owner=>requestAnimationFrame(()=>ui.picker_paint_frame(owner)))}
  /**
   * A repaint for a 'change' that did not alter the set of installed voices: while a download advances, only the numbers of
   * its progress bar change, so they are updated in place (rebuilding the rows eight times a second made a press on Cancelar
   * miss when a repaint landed between mouse down and up). Anything else (a state changed) rebuilds as usual.
   */
  paint(){return readerUI().picker_paint(this,neuralEngine)}
  patchProgress(engine){return pickerView(this).patchPickerProgress(this,engine)}
  get bookLang() { return this.host.bookLanguage() }
  announce(text) { this.host.panel.querySelector('[data-neural-status]').textContent = text }

  render(){return pickerView(this).renderPicker(this)}
  state(engine,voice){return readerUI().picker_state(this,engine,voice,DOWNLOAD_ERRORS)}
  row(engine,voice){return pickerView(this).pickerRow(this,engine,voice)}

  // --- Actions ------------------------------------------------------------------------------------------------------
  click(event){return readerUI().picker_click(this,event)}
  /** Aborts a download. Through the engine when it can (the speakers of one model share a download: the row that did not start it can cancel too). */
  cancel(id){return readerUI().picker_cancel(this,id,neuralEngine)}
  voiceName(id){return readerUI().picker_voice_name(id,neuralVoiceList)}
  /** Downloads a voice (only ever called by a tap) and selects it when it is ready. */
  async install(id){
    const ui=readerUI(),context=ui.picker_install_begin(this,id,neuralEngine,isNeuralId,()=>new AbortController());if(!context)return
    try{await context.task;ui.picker_install_done(this,id,context,declaredLanguage,langBase,neuralVoiceList)}catch(error){ui.picker_install_error(this,id,context,error,DOWNLOAD_ERRORS)}
  }
  use(id){return readerUI().picker_use(this,id,neuralEngine)}
  async remove(id){
    const ui=readerUI(),context=ui.picker_remove_begin(this,id,neuralEngine,neuralVoiceList);if(!context)return
    try{await context.engine.remove(id)}catch{}
    ui.picker_remove_done(this,id,context)
  }

  // --- First-use offer ------------------------------------------------------------------------------------------------
  dismissed(){return readerUI().picker_dismissed(readOffer)}
  /** True while 'Ahora no' still holds for this language (it expires after OFFER_SNOOZE_DAYS). */
  snoozed(base){return readerUI().picker_snoozed(this,base,now)}
  dismiss(){return readerUI().picker_dismiss(this,langBase,now,writeOffer)}
  /** Offer a download when no installed natural voice speaks the book's language, including before the first playback. */
  offerFor(engine,list){return readerUI().picker_offer_for(this,engine,list,langBase,recommendedNeuralFor,navigator.language)}
  renderOffer(engine,list){return readerUI().picker_render_offer(this,engine,list)}

  // --- Keyboard focus survives a repaint ---------------------------------------------------------------------------------
  focusKey() { return this.view.focusKey() }
  restoreFocus(key) { this.view.restoreFocus(key) }
}
