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

// The classes the constructor builds (rust-ui reader_experience_construct, reader_assembly.rs) and the arrows it keeps
// for what may run every frame of a resize or viewport scroll, or for every spoken word.
const parts = { ReaderView, ReaderLists, ReadingVoice, ReaderControls, SelectMenu, NeuralVoicePicker, normalize:normalizeReadingPreferences,
  syncMini:host => () => host.syncMiniPlayerLayout(), syncReturn:host => () => host.syncReturnLayout(),
  progress:host => () => host.updateReadingMetrics(), resize:host => () => host.chrome.resize() }

export class ReaderExperience {
  chrome = new ReaderChrome(this)
  lifecycle = new ReaderLifecycle(this)
  voiceFlow = new VoiceFlow(this)
  preferenceFlow = new PreferenceFlow(this)
  actions = new ReaderActions(this)
  navigation = new ReaderNavigation()
  get navigating() { return this.navigation.navigating }

  constructor(reader, { persist = async () => {}, onLengthMetadata = async () => {} } = {}) {
    const ui = readerUI()
    ui.reader_experience_construct(this, reader, persist, onLengthMetadata, parts, ui)
  }
  syncMiniPlayerLayout() { this.view.syncMiniPlayerLayout() }
  syncReturnLayout() { this.view.syncReturnLayout() }
}
// Answered by rust-ui experience_methods.rs: what Rust decides (reader_experience_policy.rs) and the hand-offs to
// the lifecycle, preference and voice flows, actions, view and navigation queue that own the rest; jump and step queue
// their navigation through reader_assembly.rs.
rustMethods(ReaderExperience,'experience_method',`resetAppearance ~rotateReading open relocate readingMetrics updateReadingMetrics label
 showTab showPlaceTab updateMiniPlayer updateBookmarkButton queueNavigation returnToReading ~shareBook formatSize renderPlaces renderToc
 updateReturnButton refreshNames closeVoice reset show setSleepChoice setPreference applyPreferences bookLanguage
 chooseLanguage voiceBase populateVoices error savePlaces cancelNavigation addBookmark addQuote search endSearch jump step`,
 {experience:experienceKit,runtime,preferences,state,places})
