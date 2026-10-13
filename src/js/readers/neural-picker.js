import {renderPicker,patchPickerProgress,rowPicker} from './picker-render.js'
import {statePickerVoice,dismissedPickerOffer,snoozedPickerOffer,dismissPickerOffer,offeredPickerVoice,renderPickerOffer} from './picker-policy.js'
import {clickPicker,cancelPickerDownload,namePickerVoice,installPickerVoice,usePickerVoice,removePickerVoice} from './picker-actions.js'
import {warmPicker,refreshPicker,usedPicker,attachPicker,contextPicker,currentPicker,cancelPicker,warmUpPicker,changedPicker,paintPicker} from './picker-warm.js'
// The "Voces naturales" part of the audio panel: the list of downloadable on-device voices (Descargar /
// progress and Cancelar / Instalada, Usar and Quitar / error and Reintentar), the warning shown
// when the neural voice was given up on, and the first-use offer row. It talks to the engine only through
// neural-runtime.js, never downloads by itself, and stays hidden where the engine is unsupported or failed to load.
import { readerUI } from './rust-ui-required.js'




 // 'Ahora no' means not now: the offer comes back for that language after this long



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
  warm(){return warmPicker(this)}
  /** (Re)loads the engine module if it is not there yet and re-reads what is installed. Cheap; called when the audio tab opens. */
  refresh({warm=true}={}){return refreshPicker(this,warm)}
  used(){return usedPicker(this)}
  attach(warm=true){return attachPicker(this,warm)}
  /**
   * Starts the engine's worker and loads the model of the voice the next Play will use, so the tap does not pay the cold start
   * (3-6 s). The engine tears it down by itself after ~90 s without speech. Does nothing unless that voice is a downloaded neural one.
   */
  warmContext(){return contextPicker(this)}
  isWarmCurrent(context){return currentPicker(this,context)}
  cancelWarm(){return cancelPicker(this)}
  warmUp(){return warmUpPicker(this)}
  /** Installed set changes rebuild the voice select too; download progress only repaints this block. */
  changed(){return changedPicker(this)}
  /**
   * A repaint for a 'change' that did not alter the set of installed voices: while a download advances, only the numbers of
   * its progress bar change, so they are updated in place (rebuilding the rows eight times a second made a press on Cancelar
   * miss when a repaint landed between mouse down and up). Anything else (a state changed) rebuilds as usual.
   */
  paint(){return paintPicker(this)}
  patchProgress(engine){return patchPickerProgress(this,engine)}
  get bookLang() { return this.host.bookLanguage() }
  announce(text) { this.host.panel.querySelector('[data-neural-status]').textContent = text }

  render(){return renderPicker(this)}
  state(engine,voice){return statePickerVoice(this,engine,voice)}
  row(engine,voice){return rowPicker(this,engine,voice)}

  // --- Actions ------------------------------------------------------------------------------------------------------
  click(event){return clickPicker(this,event)}
  /** Aborts a download. Through the engine when it can (the speakers of one model share a download: the row that did not start it can cancel too). */
  cancel(id){return cancelPickerDownload(this,id)}
  voiceName(id){return namePickerVoice(id)}
  /** Downloads a voice (only ever called by a tap) and selects it when it is ready. */
  install(id){return installPickerVoice(this,id)}
  use(id){return usePickerVoice(this,id)}
  remove(id){return removePickerVoice(this,id)}

  // --- First-use offer ------------------------------------------------------------------------------------------------
  dismissed(){return dismissedPickerOffer()}
  /** True while 'Ahora no' still holds for this language (it expires after OFFER_SNOOZE_DAYS). */
  snoozed(base){return snoozedPickerOffer(this,base)}
  dismiss(){return dismissPickerOffer(this)}
  /** Offer a download when no installed natural voice speaks the book's language, including before the first playback. */
  offerFor(engine,list){return offeredPickerVoice(this,engine,list)}
  renderOffer(engine,list){return renderPickerOffer(this,engine,list)}

  // --- Keyboard focus survives a repaint ---------------------------------------------------------------------------------
  focusKey() { return this.view.focusKey() }
  restoreFocus(key) { this.view.restoreFocus(key) }
}
