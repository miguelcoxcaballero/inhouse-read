import {readerUI,rustMethods} from './rust-ui-required.js'
import {ReaderChrome} from './reader-chrome.js'
import {ReaderLifecycle} from './reader-lifecycle.js'
import {VoiceFlow} from './voice-flow.js'
import {PreferenceFlow} from './preference-flow.js'
import { readerIcon } from './reader-interface.js'
import { normalizeReadingPreferences, rateLabel } from './reading-preferences.js'
import * as runtime from './neural-runtime.js'
import * as preferences from './reading-preferences.js'
import * as state from './reading-state.js'
import * as places from './reading-places.js'
import { ReadingVoice } from './reading-voice.js'
import { SelectMenu } from './select-menu.js'
import { ReaderView } from './reader-view.js'
import { ReaderLists } from './reader-lists.js'
import { NeuralVoicePicker } from './neural-picker.js'
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
  jump(place, target) {
    return this.queueNavigation(current => this.actions.jump(place,target,current))
  }
  step(direction) {
    // Consult another page without moving the independent audible cursor.
    return this.queueNavigation(() => this.voice.continueFromPage(() => readerUI().reader_experience_page_step(this,direction)))
  }
}
// Answered by rust-ui experience_methods.rs: what Rust decides (reader_experience_policy.rs) and the hand-offs to
// the lifecycle, preference and voice flows, actions, view and navigation queue that own the rest.
rustMethods(ReaderExperience,'experience_method',`resetAppearance ~rotateReading open relocate readingMetrics updateReadingMetrics label
 showTab showPlaceTab updateMiniPlayer updateBookmarkButton queueNavigation returnToReading ~shareBook formatSize renderPlaces renderToc
 updateReturnButton refreshNames closeVoice reset show syncMiniPlayerLayout syncReturnLayout setSleepChoice setPreference applyPreferences bookLanguage
 chooseLanguage voiceBase populateVoices error savePlaces cancelNavigation addBookmark addQuote search endSearch`,
 {experience:experienceKit,runtime,preferences,state,places})
