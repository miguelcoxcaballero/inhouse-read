// Audiobook chapter text must not wait for a hidden WebView to navigate an
// iframe. Foliate's own detached documents and CFI parser provide the same
// source text and exact saved position; rendering is only needed on return.
// The decisions are Rust (cursor_* in rust-ui); this class holds the state they
// read and the callbacks Foliate and the voice session invoke.
import { SectionProgress } from 'foliate-js/progress.js'
import { Overlayer } from 'foliate-js/overlayer.js'
import { mapSpeechText } from './speech-map.js'
import { speechPageBreaks } from './speech-page-breaks.js'
import { readerUI, rustMethods } from './rust-ui-required.js'

// The constructor, wrap() and the handlers of the chapters next() finds: rust-ui cursor_* (foliate_open.rs).
const kit = { SectionProgress, mapText:mapSpeechText, pageBreaks:speechPageBreaks }

export class FoliateSpeechCursor {
  constructor(view, { env = document, onRelocate = () => {}, theme = () => 'light' } = {}) {
    const ui = readerUI()
    ui.cursor_construct(this, view, env, onRelocate, theme, kit, ui)
  }
  get detached() { return Boolean(this.current?.detached) }
  get active() { return Boolean(this.current) }
  reset() { ++this.epoch; this.current = null; this.browsing = false }
  browse() { this.browsing = true }
}
// returnToSpeech, close, wrap, next and currentSource: rust-ui cursor_member (foliate_members.rs). reset and browse are
// reached by every wheel tick while the audiobook plays and stay here.
rustMethods(FoliateSpeechCursor,'cursor_member','!returnToSpeech close wrap !next currentSource',kit)
// valid, remember and reveal (only the most recent audible CFI is shown): rust-ui foliate_cursor.rs via foliate_method.
rustMethods(FoliateSpeechCursor,'foliate_method','valid remember reveal',{get Overlayer(){return Overlayer}})
