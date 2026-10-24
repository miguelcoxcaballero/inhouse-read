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

// Promise and callback adapters retain browser/engine identities. The reader
// chunk is instantiated only after requireRustUI; these never start a load.
const experienceKit = {
  title:displayBookTitle, rate:rateLabel, icon:readerIcon,
  metadata:(host, value, record, epoch) => Promise.resolve(value)
    .then(metadata => readerUI().reader_experience_metadata(host, record, epoch, metadata)).catch(() => {}),
  current:(host, book, generation) => () => readerUI().reader_experience_current(host, book, generation),
  returnAction:(host, place) => current => host.actions.returnToReading(place, current),
  labels:(host, places) => places.map(place => readerUI().reader_experience_place_label(host, place)),
  select:(host, name) => (index, place) => readerUI().reader_experience_select_place(host, name, index, place),
  remove:(host, name, places) => async index => readerUI().reader_experience_remove_place(host, name, places, index),
  toc:host => href => host.jump(null, href),
  revoker:url => () => URL.revokeObjectURL(url),
}

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
    readerUI().reader_experience_init(this, normalizeReadingPreferences)
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
    readerUI().reader_experience_selection_init(this)
    document.addEventListener('selectionchange', () => readerUI().reader_experience_selection_changed(this))
    window.addEventListener('inhouse-reader-selection',event => readerUI().reader_experience_remember_selection(this,event.detail))
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
    return readerUI().reader_experience_reset_appearance(this, normalizeReadingPreferences)
  }
  async rotateReading() {
    return readerUI().reader_experience_rotate(this)
  }
  /** The title written on the spine or the author changed (in the shelf's
   * editor, maybe while this book was already prepared): show them here too. */
  refreshNames(bookId,fields) { return this.lifecycle.refreshNames(bookId,fields) }
  open(record) {
    return readerUI().reader_experience_open(this, record, experienceKit)
  }
  closeVoice() { return closeReaderVoice(this) }
  reset() { return this.lifecycle.reset() }
  relocate() {
    return readerUI().reader_experience_relocate(this, clonePlace)
  }
  readingMetrics() {
    return readerUI().reader_experience_metrics(this)
  }
  updateReadingMetrics() {
    return readerUI().reader_experience_update_metrics(this)
  }
  label(place) { return readerUI().reader_experience_label(this, place) }
  show(tab) { return this.lifecycle.show(tab) }
  showTab(name) {
    return readerUI().reader_experience_show_tab(this, name)
  }
  showPlaceTab(name) {
    return readerUI().reader_experience_place_tab(this, name)
  }
  updateMiniPlayer(state = this.voice?.state, message = '') {
    return readerUI().reader_experience_mini_player(this, state, message, experienceKit)
  }
  syncMiniPlayerLayout() {
    this.view.syncMiniPlayerLayout()
  }
  syncReturnLayout() {
    this.view.syncReturnLayout()
  }
  updateBookmarkButton() {
    return readerUI().reader_experience_bookmark(this, isBookmarked)
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
    return readerUI().reader_experience_queue(this, action, experienceKit)
  }
  jump(place, target) {
    return this.queueNavigation(current => this.actions.jump(place,target,current))
  }
  returnToReading(index = 0) {
    return readerUI().reader_experience_return(this, index, experienceKit)
  }
  addBookmark() { return this.actions.addBookmark() }
  addQuote() { return this.actions.addQuote() }
  search(query) { return this.actions.search(query) }
  endSearch() { return this.actions.endSearch() }
  async shareBook() {
    return readerUI().reader_experience_share(this, experienceKit)
  }
  formatSize(bytes = 0) { return readerUI().reader_experience_size(bytes) }
  renderPlaces() {
    return readerUI().reader_experience_places(this, experienceKit)
  }
  renderToc() {
    return readerUI().reader_experience_toc(this, experienceKit)
  }
  step(direction) {
    // Consult another page without moving the independent audible cursor.
    return this.queueNavigation(() => this.voice.continueFromPage(() => readerUI().reader_experience_page_step(this,direction)))
  }
  updateReturnButton() {
    return readerUI().reader_experience_return_button(this)
  }
}
