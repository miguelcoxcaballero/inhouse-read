import {ReaderChrome} from './reader-chrome.js'
import {ReaderLifecycle,closeReaderVoice} from './reader-lifecycle.js'
import {VoiceFlow} from './voice-flow.js'
import {PreferenceFlow} from './preference-flow.js'
import { normalizeReadingPreferences } from './reading-preferences.js'
import { ReadingVoice } from './reading-voice.js'
import { SelectMenu } from './select-menu.js'
import { ReaderView } from './reader-view.js'
import { ReaderLists } from './reader-lists.js'
import { NeuralVoicePicker } from './neural-picker.js'
import { clonePlace } from './reading-state.js'
import { ReaderNavigation } from './reader-navigation.js'
import { ReaderActions } from './reader-actions.js'
import { ReaderControls } from './reader-controls.js'
import { readerUI } from './rust-ui-required.js'
import { displayBookTitle } from '../book-title.js'

// How the experience is put together, how a place is named, what the mini player and the return button show, how
// the lists are drawn and how a book is shared is Rust (exp_* in rust-ui); this class holds the state and the objects
// the app and the other components reach through it. The frozen original is tests/unit/helpers/reference-reader-experience.js.
const kit = { normalize:normalizeReadingPreferences, ReaderView, ReaderLists, ReadingVoice, ReaderControls, SelectMenu, NeuralVoicePicker }

export class ReaderExperience {
  chrome = new ReaderChrome(this)
  lifecycle = new ReaderLifecycle(this)
  voiceFlow = new VoiceFlow(this)
  preferenceFlow = new PreferenceFlow(this)
  actions = new ReaderActions(this)
  navigation = new ReaderNavigation()
  get navigating() { return this.navigation.navigating }
  // What each list's rows call: the place opened or the row removed (bound to its list by the Rust renderer).
  #openPlace = (name, index, place) => name === 'history' ? this.returnToReading(index) : this.jump(place)
  #removePlace = (name, places, index) => readerUI().exp_remove_place(this, name, places, index)

  constructor(reader, { persist = async () => {} } = {}) {
    this.reader = reader
    this.persist = persist
    readerUI().exp_build(this, kit)
  }
  resetAppearance() { readerUI().exp_reset_appearance(this, normalizeReadingPreferences) }
  rotateReading() { return readerUI().exp_rotate(this) }
  /** The title written on the spine or the author changed (in the shelf's
   * editor, maybe while this book was already prepared): show them here too. */
  refreshNames(bookId,fields) { return this.lifecycle.refreshNames(bookId,fields) }
  open(record) { return this.lifecycle.open(record) }
  closeVoice() { return closeReaderVoice(this) }
  reset() { return this.lifecycle.reset() }
  relocate() { readerUI().exp_relocate(this, clonePlace) }
  label(place) { return readerUI().exp_label(this, place) }
  show(tab) { return this.lifecycle.show(tab) }
  showTab(name) { readerUI().exp_show_tab(this, name) }
  showPlaceTab(name) { readerUI().exp_show_place_tab(this, name) }
  updateMiniPlayer(state = this.voice?.state, message = '') { readerUI().exp_mini(this, state, message, displayBookTitle) }
  syncMiniPlayerLayout() {
    this.view.syncMiniPlayerLayout()
  }
  syncReturnLayout() {
    this.view.syncReturnLayout()
  }
  updateBookmarkButton() { readerUI().exp_bookmark_button(this) }
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
  error(message) { readerUI().exp_error(this, message) }
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
  shareBook() { return readerUI().exp_share(this, displayBookTitle) }
  formatSize(bytes = 0) { return readerUI().exp_format_size(bytes) }
  renderPlaces() { readerUI().exp_render_places(this, this.#openPlace, this.#removePlace) }
  renderToc() { readerUI().exp_render_toc(this, href => this.jump(null,href)) }
  step(direction) {
    // Consult another page without moving the independent audible cursor.
    return this.queueNavigation(() => this.voice.continueFromPage(() => direction > 0 ? this.reader.next() : this.reader.prev()))
  }
  updateReturnButton() { readerUI().exp_return_button(this) }
}
