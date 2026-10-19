import {readerUI} from './rust-ui-required.js'
import {ReaderChrome} from './reader-chrome.js'
import {ReaderLifecycle,closeReaderVoice} from './reader-lifecycle.js'
import {VoiceFlow} from './voice-flow.js'
import {PreferenceFlow} from './preference-flow.js'
import { readerIcon } from './reader-interface.js'
import { normalizeReadingPreferences, rateLabel } from './reading-preferences.js'
import { ReadingVoice } from './reading-voice.js'
import { SelectMenu } from './select-menu.js'
import { ReaderView } from './reader-view.js'
import { ReaderLists } from './reader-lists.js'
import { NeuralVoicePicker } from './neural-picker.js'
import { clonePlace } from './reading-state.js'
import { isBookmarked } from './reading-places.js'
import { ReaderNavigation } from './reader-navigation.js'
import { ReaderActions } from './reader-actions.js'
import { ReaderControls } from './reader-controls.js'
import { displayBookTitle } from '../book-title.js'

const STORAGE_KEY = 'inhouse-read-reading-preferences'

export class ReaderExperience {
  chrome = new ReaderChrome(this)
  lifecycle = new ReaderLifecycle(this)
  voiceFlow = new VoiceFlow(this)
  preferenceFlow = new PreferenceFlow(this)
  actions = new ReaderActions(this)
  navigation = new ReaderNavigation()
  get navigating() { return this.navigation.navigating }

  constructor(reader, { persist = async () => {}, onLengthMetadata = async () => {} } = {}) {
    this.reader = reader
    this.persist = persist
    this.onLengthMetadata = onLengthMetadata
    this.history = []; this.bookmarks = []; this.quotes = []; this.location = { fraction:0, locator:null }
    try { this.preferences = normalizeReadingPreferences(JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')) }
    catch { this.preferences = normalizeReadingPreferences() }
    this.chrome.create()
    this.view = new ReaderView(this.screen,this.panel,this.miniPlayer,this.returnButton)
    this.lists = new ReaderLists(this.panel)
    if (typeof ResizeObserver === 'function') {
      this.miniPlayerResizeObserver = new ResizeObserver(() => this.syncMiniPlayerLayout())
      this.miniPlayerResizeObserver.observe(this.miniPlayer)
      this.returnResizeObserver = new ResizeObserver(() => this.syncReturnLayout())
      this.returnResizeObserver.observe(this.returnButton)
    }
    document.body.append(this.panel)
    this.selectedQuoteSelection = null
    this.quoteColor = 'yellow'
    const rememberSelection = selection => { if (selection?.text) this.selectedQuoteSelection = selection }
    document.addEventListener('selectionchange', () => {
      if (!this.screen.contains(document.activeElement) && !this.screen.contains(window.getSelection()?.anchorNode?.parentElement)) return
      const selection = this.reader.getSelection()
      rememberSelection(typeof selection === 'string' ? {text:selection,locator:this.reader.location.locator} : selection)
    })
    window.addEventListener('inhouse-reader-selection',event => rememberSelection(event.detail))
    this.voice = new ReadingVoice(reader, (state,message) => this.chrome.voiceState(state,message))
    this.voice.onProgress = () => this.updateReadingMetrics()
    this.controls = new ReaderControls(this)
    // Idioma first, then the voices of that language. Both are the app's own dropdowns (no operating-system <select>);
    // the downloadable natural voices of the chosen language live at the end of the voice list.
    this.languageMenu = new SelectMenu({ label:'Idioma', onChange:value => this.chooseLanguage(value) })
    this.voiceMenu = new SelectMenu({ label:'Voz', extra:this.panel.querySelector('[data-neural]'), onChange:value => this.setPreference('voice', value) })
    this.panel.querySelector('[data-voice-menus]').append(this.languageMenu.root, this.voiceMenu.root)
    this.neuralPicker = new NeuralVoicePicker(this)
    this.populateVoices()
    const resize = () => this.chrome.resize()
    window.visualViewport?.addEventListener('resize', resize)
    window.visualViewport?.addEventListener('scroll', resize)
    window.addEventListener('resize', resize)
    this.resizePanel = resize
  }
  resetAppearance() {
    this.preferences = normalizeReadingPreferences({ rate:this.preferences.rate, voice:this.preferences.voice, voiceLang:this.preferences.voiceLang })
    this.applyPreferences()
  }
  async rotateReading() {
    try {
      if (screen.orientation?.lock) { await screen.orientation.lock(screen.orientation.type.startsWith('portrait') ? 'landscape' : 'portrait'); this.error('') }
      else this.error('No se puede girar.')
    } catch { this.error('Gira el dispositivo.') }
  }
  /** The title written on the spine or the author changed (in the shelf's
   * editor, maybe while this book was already prepared): show them here too. */
  refreshNames(bookId,fields) { return this.lifecycle.refreshNames(bookId,fields) }
  open(record) {
    this.lengthMetadata = record
    const pending = this.lifecycle.open(record), epoch = this.reader.epoch
    // The engine already caches this count. Do not block opening or let a
    // late count from a closed book leak into the next reader session.
    if (!record.wordCountComplete && this.reader.getLengthMetadata) {
      Promise.resolve(this.reader.getLengthMetadata()).then(metadata => {
        if (this.book !== record || this.reader.epoch !== epoch || !metadata) return
        this.lengthMetadata = {...record,...metadata}
        this.relocate()
        return this.onLengthMetadata(record, metadata)
      }).catch(() => {})
    }
    return pending
  }
  closeVoice() { return closeReaderVoice(this) }
  reset() { return this.lifecycle.reset() }
  relocate() {
    this.location = {...clonePlace(this.reader.location),section:this.reader.location.section || '',page:this.reader.location.page || ''}
    const label = this.label(this.location)
    const compactLabel = this.readingMetrics().compact
    this.view.relocate(label,compactLabel,this.location.fraction * 100,
      this.location.locator?.kind === 'pdf-page',this.location.locator?.value)
    this.updateBookmarkButton()
    this.updateReadingMetrics()
  }
  readingMetrics() {
    return readerUI().reader_reading_metrics(this.reader.s, this.reader.location,
      {...this.lengthMetadata, pageCount:this.reader.pageCount}, this.preferences.rate,
      ['playing','paused','loading'].includes(this.voice?.state))
  }
  updateReadingMetrics() {
    const metrics = this.readingMetrics()
    this.view.updateReadingMetrics(metrics.time, metrics.pagesDescription)
  }
  label(place) { return readerUI().reader_place_label(place, this.reader) }
  show(tab) { return this.lifecycle.show(tab) }
  showTab(name) {
    if (name !== 'search') this.endSearch()
    this.view.showTab(name)
  }
  showPlaceTab(name) {
    this.placeTab = name
    this.view.showPlaceTab(name)
  }
  updateMiniPlayer(state = this.voice?.state, message = '') {
    this.view.updateMiniPlayer(state || '',message,displayBookTitle(this.book),rateLabel(this.preferences.rate),Boolean(this.book),readerIcon(state === 'playing' ? 'pause' : 'play'))
    this.updateReadingMetrics()
  }
  syncMiniPlayerLayout() {
    this.view.syncMiniPlayerLayout()
  }
  syncReturnLayout() {
    this.view.syncReturnLayout()
  }
  updateBookmarkButton() {
    const marked = isBookmarked(this.bookmarks,this.location)
    this.view.updateBookmarkButton(marked)
  }
  setPreference(key,value,{restart=true}={}) { return this.preferenceFlow.set(key,value,restart) }
  applyPreferences(updateBook=true) { return this.preferenceFlow.apply(updateBook) }
  /** The language of the open book (the device's when it has none or no book is open). */
  bookLanguage() { return this.voiceFlow.bookLanguage() }
  setSleepChoice(minutes) {
    this.view.setSleepChoice(minutes)
  }
  /** Picking a language: the voice goes back to Automática unless the one in use already speaks it. */
  chooseLanguage(value) { return this.voiceFlow.chooseLanguage(value) }
  voiceBase(voices) { return this.voiceFlow.voiceBase(voices) }
  populateVoices() { return this.voiceFlow.populateVoices() }
  error(message) { this.panel.querySelector('.reading-error').textContent = message }
  savePlaces() { return this.actions.savePlaces() }
  cancelNavigation() {
    this.navigation.cancel()
  }
  queueNavigation(action) {
    if (!this.book) return Promise.resolve()
    const book = this.book, generation = this.navigation.generation
    const isCurrent = () => this.book === book && this.navigation.generation === generation
    // A section becomes visible before its history write finishes. Preserve
    // links tapped in that interval instead of silently dropping the request.
    return this.navigation.enqueue(action,isCurrent)
  }
  jump(place, target) {
    return this.queueNavigation(current => this.actions.jump(place,target,current))
  }
  returnToReading(index = 0) {
    const place = this.history[index]
    if (!place) return Promise.resolve()
    return this.queueNavigation(current => this.actions.returnToReading(place,current))
  }
  addBookmark() { return this.actions.addBookmark() }
  addQuote() { return this.actions.addQuote() }
  search(query) { return this.actions.search(query) }
  endSearch() { return this.actions.endSearch() }
  async shareBook() {
    const content = this.book?.content
    if (!content) { this.error('Archivo original no disponible.'); return }
    const [name, type] = readerUI().reader_share_file(this.book, content), file = new File([content],name,{type})
    try {
      if (navigator.canShare?.({files:[file]}) && navigator.share) await navigator.share({title:displayBookTitle(this.book),files:[file]})
      else { const url = URL.createObjectURL(file), link = document.createElement('a'); link.href=url; link.download=file.name; link.click(); setTimeout(()=>URL.revokeObjectURL(url),30000) }
      this.panel.close()
    } catch (error) { if (error.name !== 'AbortError') this.error('No se pudo compartir.') }
  }
  renderPlaces() {
    this.updateBookmarkButton()
    this.updateReturnButton()
    for (const [name, places] of [['history',this.history],['bookmarks',this.bookmarks],['quotes',this.quotes]]) {
      this.lists.renderPlaces(name,places,places.map(place => place.label || this.label(place)),
        (index,place) => name === 'history' ? this.returnToReading(index) : this.jump(place),
        async index => { const [removed] = places.splice(index,1); if (name === 'quotes') this.reader.removeQuoteAnnotation(removed); await this.savePlaces(); this.renderPlaces() },readerIcon('close'))
    }
  }
  renderToc() {
    const available = this.lists.renderToc(this.reader.toc,href => this.jump(null,href))
    this.showPlaceTab(available ? 'toc' : 'bookmarks')
  }
  step(direction) {
    // Consult another page without moving the independent audible cursor.
    return this.queueNavigation(() => this.voice.continueFromPage(() => direction > 0 ? this.reader.next() : this.reader.prev()))
  }
  updateReturnButton() {
    const audio = this.voice?.browsing
    this.view.updateReturnButton(Boolean(audio),Boolean(this.history.length),this.history.length ? this.history[0].label || this.label(this.history[0]) : '')
  }
}
