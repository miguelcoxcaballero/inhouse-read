import {clickPicker,cancelPickerDownload,namePickerVoice,installPickerVoice,usePickerVoice,removePickerVoice} from './picker-actions.js'
import {warmPicker,refreshPicker,usedPicker,attachPicker,contextPicker,currentPicker,cancelPicker,warmUpPicker,changedPicker,paintPicker} from './picker-warm.js'
// The "Voces naturales" part of the audio panel: the list of downloadable on-device voices (Descargar /
// progress and Cancelar / Instalada, Usar and Quitar / error and Reintentar), the warning shown
// when the neural voice was given up on, and the first-use offer row. It talks to the engine only through
// neural-runtime.js, never downloads by itself, and stays hidden where the engine is unsupported or failed to load.
import { NeuralView } from './neural-view.js'
import { neuralEngine, neuralVoiceList } from './neural-runtime.js'
import { langBase, languageName, orderNeuralVoices, recommendedNeuralFor } from './voice-catalog.js'

const OFFER_KEY = 'inhouse-read-neural-offer-dismissed'
const OFFER_SNOOZE_DAYS = 30 // 'Ahora no' means not now: the offer comes back for that language after this long
const DOWNLOAD_ERRORS = {
  offline:'Sin conexión.',
  storage:'Sin espacio en el dispositivo.',
  default:'No se pudo descargar.'
}
const WARNINGS = {
  'not-installed':'La voz natural seleccionada no está instalada. Descárgala de nuevo.',
  default:'No se pudo iniciar la voz natural. Pulsa Reintentar para volver a usarla.'
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
    this.view = new NeuralView(panel)
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
  patchProgress(engine) {
    const list = neuralVoiceList(engine)
    if (this.block.hidden || !list.length) return false
    for (const item of this.block.querySelectorAll('[data-neural-voice]')) {
      const voice = list.find(candidate => candidate.id === item.dataset.neuralVoice)
      if (!voice) return false
      const { name, download } = this.state(engine, voice)
      if (name !== item.dataset.state) return false
      if (name === 'downloading') { const wrap = item.querySelector('.reading-neural-progress'); if (!wrap) return false; this.view.paintProgress(wrap, download, voice) }
    }
    const offered = this.offerFor(engine, list)
    if ((offered?.id || '') !== (this.offer.dataset.voice || '')) return false
    if (offered) {
      const { name, download } = this.state(engine, offered)
      if (name !== this.offer.dataset.state) return false
      if (name === 'downloading') { const wrap = this.offer.querySelector('.reading-neural-progress'); if (!wrap) return false; this.view.paintProgress(wrap, download, offered) }
    }
    return true
  }
  get bookLang() { return this.host.bookLanguage() }
  announce(text) { this.host.panel.querySelector('[data-neural-status]').textContent = text }

  render() {
    cancelAnimationFrame(this.frame); this.frame = 0
    const engine = neuralEngine(), list = engine ? neuralVoiceList(engine) : []
    this.signature = engine ? [...engine.installed].sort().join(',') : ''
    this.block.hidden = !list.length
    if (!list.length) { this.offer.hidden = true; this.offer.replaceChildren(); return }
    const focus = this.focusKey()
    // The list sits inside the Voz dropdown, so it only shows the voices of the language chosen in the Idioma dropdown.
    const shown = this.host.voiceBaseShown
    const ordered = orderNeuralVoices(list, { bookLang:this.bookLang, deviceLang:navigator.language }).filter(voice => !shown || voice.base === shown)
    this.block.hidden = !ordered.length
    const reason = this.host.voice?.neuralOff
    this.block.querySelector('[data-neural-warning]').hidden = !reason
    this.block.querySelector('[data-neural-warning-text]').textContent = reason ? WARNINGS[reason] || WARNINGS.default : ''
    this.block.querySelector('[data-neural-list]').replaceChildren(...ordered.map(voice => this.row(engine, voice)))
    this.renderOffer(engine, list)
    this.restoreFocus(focus)
  }
  state(engine, voice) {
    const download = engine.downloads?.get(voice.id)
    if (engine.installed.has(voice.id)) return { name:'installed' }
    if (this.tasks.has(voice.id) || download?.state === 'downloading') return { name:'downloading', download }
    if (this.errors.has(voice.id) || download?.state === 'error') return { name:'error', message:this.errors.get(voice.id) || DOWNLOAD_ERRORS[download?.code] || DOWNLOAD_ERRORS.default }
    return { name:'idle' }
  }
  row(engine, voice) {
    const expansion = Boolean(voice.sharedPack && voice.upgradeBytes > 0 && [...engine.installed].some(id=>id.startsWith(voice.modelKey+':')))
    const size = expansion ? Math.round(voice.upgradeBytes/1e6) : Math.round(voice.sizeMB)
    const license = voice.licenseUrl ? new URL(voice.licenseUrl, new URL(import.meta.env?.BASE_URL || '/', location.href)).href : ''
    return this.view.row(voice,this.state(engine,voice),this.host.preferences.voice === voice.id,expansion,languageName(voice.lang),size,license)
  }

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
  dismissed() { try { return JSON.parse(localStorage.getItem(OFFER_KEY) || '{}') || {} } catch { return {} } }
  /** True while 'Ahora no' still holds for this language (it expires after OFFER_SNOOZE_DAYS). */
  snoozed(base) {
    const at = this.dismissed()[base]
    return at === true || (Number(at) > 0 && Date.now() - Number(at) < OFFER_SNOOZE_DAYS * 864e5)
  }
  dismiss() {
    const base = langBase(this.bookLang)
    try { localStorage.setItem(OFFER_KEY, JSON.stringify({ ...this.dismissed(), [base]:Date.now() })) } catch { /* it just asks again next time */ }
    this.render()
  }
  /** Offer a download when no installed natural voice speaks the book's language, including before the first playback. */
  offerFor(engine, list) {
    const base = langBase(this.bookLang)
    if (!engine || !base || !this.host.voice || this.snoozed(base)) return null
    if (list.some(voice => voice.base === base && engine.installed.has(voice.id))) return null
    return recommendedNeuralFor(list, this.bookLang, navigator.language)
  }
  renderOffer(engine, list) {
    const voice = this.offerFor(engine, list)
    this.view.renderOffer(voice,voice ? this.state(engine,voice) : null)
  }

  // --- Keyboard focus survives a repaint ---------------------------------------------------------------------------------
  focusKey() { return this.view.focusKey() }
  restoreFocus(key) { this.view.restoreFocus(key) }
}
