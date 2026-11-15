import {readerUI,rustMethods} from './rust-ui-required.js'
import {ReaderChrome} from './reader-chrome.js'
import {ReaderLifecycle} from './reader-lifecycle.js'
import {VoiceFlow} from './voice-flow.js'
import {PreferenceFlow} from './preference-flow.js'
import { rateLabel } from './reading-preferences.js'
import * as runtime from './neural-runtime.js'
import * as preferences from './reading-preferences.js'
import * as state from './reading-state.js'
import { ReadingVoice } from './reading-voice.js'
import { NeuralVoicePicker } from './neural-picker.js'
import { ReaderActions } from './reader-actions.js'
import { displayBookTitle } from '../book-title.js'

// The names and the rate label of the mini player and the share sheet; every other callback of the
// experience is a bound export of rust-ui (reader_experience_policy.rs, experience_shell.rs).
const experienceKit = { title:displayBookTitle, rate:rateLabel }
const kit = { experience:experienceKit, runtime, preferences, state, ReadingVoice, NeuralVoicePicker }

export class ReaderExperience {
  chrome = new ReaderChrome(this)
  lifecycle = new ReaderLifecycle(this)
  voiceFlow = new VoiceFlow(this)
  preferenceFlow = new PreferenceFlow(this)
  actions = new ReaderActions(this)
  navigation = new (readerUI().RustReaderNavigation)()
  get navigating() { return this.navigation.navigating }

  constructor(reader, { persist = async () => {}, onLengthMetadata = async () => {} } = {}) {
    // Its state, panel, listeners, voice, controls and menus, in this order: rust-ui experience_shell.rs.
    const ui = readerUI()
    ui.reader_experience_construct(this, reader, persist, onLengthMetadata, kit, ui)
  }
  syncMiniPlayerLayout() { this.view.syncMiniPlayerLayout() }
  syncReturnLayout() { this.view.syncReturnLayout() }
}
// Answered by rust-ui experience_methods.rs (jump and step queue a navigation step): what Rust decides (reader_experience_policy.rs) and the hand-offs to
// the lifecycle, preference and voice flows, actions, view and navigation queue that own the rest.
rustMethods(ReaderExperience,'experience_method',`jump step resetAppearance ~rotateReading open relocate readingMetrics updateReadingMetrics label
 showTab showPlaceTab updateMiniPlayer updateBookmarkButton queueNavigation returnToReading ~shareBook formatSize renderPlaces renderToc
 updateReturnButton refreshNames closeVoice reset show setSleepChoice setPreference applyPreferences bookLanguage
 chooseLanguage voiceBase populateVoices error savePlaces cancelNavigation addBookmark addQuote search endSearch`,
 kit)
