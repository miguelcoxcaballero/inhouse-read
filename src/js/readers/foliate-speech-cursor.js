// Audiobook chapter text must not wait for a hidden WebView to navigate an
// iframe. Foliate's own detached documents and CFI parser provide the same
// source text and exact saved position; rendering is only needed on return.
// The decisions are Rust (cursor_* in rust-ui); this class holds the state they
// read and the callbacks Foliate and the voice session invoke.
import { SectionProgress } from 'foliate-js/progress.js'
import { Overlayer } from 'foliate-js/overlayer.js'
import { mapSpeechText } from './speech-map.js'
import { speechPageBreaks } from './speech-page-breaks.js'
import { SPEECH_HIGHLIGHT, clearSpeechRange } from './speech-highlight.js'
import { readerUI, rustMethods } from './rust-ui-required.js'

export class FoliateSpeechCursor {
  constructor(view, { env = document, onRelocate = () => {}, theme = () => 'light' } = {}) {
    Object.assign(this, { view, env, onRelocate, theme })
    this.book = view.book
    this.epoch = 0
    this.current = null
    this.revealing = null
    this.closed = false
    this.browsing = false
    this.progress = new SectionProgress(this.book?.sections || [], 1500, 1600)
    this.onVisibility = () => { if (!env.hidden) void this.reveal().catch(() => {}) }
    env.addEventListener('visibilitychange', this.onVisibility)
  }
  get detached() { return Boolean(this.current?.detached) }
  get active() { return Boolean(this.current) }
  reset() { ++this.epoch; this.current = null; this.browsing = false }
  browse() { this.browsing = true }
  async returnToSpeech() { this.browsing = false; await this.reveal() }
  close() { this.reset(); this.closed = true; this.env.removeEventListener('visibilitychange', this.onVisibility) }

  // Attach a precise logical position to the chapter already on screen.
  // Its ordinary page cuts/highlighting remain in use while visible.
  wrap(source, map, index) {
    const { highlight, follow, clear } = source, ui = readerUI()
    const state = ui.cursor_state(this, source, map, index, mapSpeechText)
    source.adopt = () => { state.epoch = this.epoch }
    source.highlight = (start, end) => ui.cursor_highlight(this, state, highlight, start, end)
    source.follow = (start, end) => ui.cursor_follow(this, state, map, follow, start, end)
    source.clear = () => ui.cursor_clear(state, clear)
    return source
  }

  async next({ isActive = () => true } = {}) {
    const ui = readerUI(), found = await ui.cursor_next(this, isActive, mapSpeechText)
    if (!found?.state) return found
    const { source, state, epoch, previous } = found, map = state.map
    const valid = () => ui.cursor_check(this, epoch, previous, isActive)
    let activated = false
    source.isValid = () => activated ? this.valid() && this.current === state : valid()
    source.activate = () => {
      if (activated) return source.isValid()
      if (!valid()) return false
      activated = true
      this.current = state
      return true
    }
    // Once this chapter is on screen, its pages break where the rendered copy of the same text does.
    source.measurePageBreaks = () => ui.cursor_measure(this, state, source, activated, map, mapSpeechText, speechPageBreaks)
    source.highlight = (start, end) => { state.sentence = [start, end] }
    source.follow = (start, end) => {
      if (!activated || !source.isValid()) return
      this.remember(state, start, end)
      if (!this.env.hidden) return this.reveal()
    }
    source.clear = () => {
      state.sentence = null
      for (const content of this.view.renderer?.getContents?.() || []) {
        clearSpeechRange(content.doc)
        try { content.overlayer?.remove(SPEECH_HIGHLIGHT) } catch { /* closed document */ }
      }
    }
    return source
  }

  currentSource() {
    const state = this.current
    return state ? { ...state.source, start:state.offset } : null
  }
}
// valid, remember and reveal (only the most recent audible CFI is shown): rust-ui foliate_cursor.rs via foliate_method.
rustMethods(FoliateSpeechCursor,'foliate_method','valid remember reveal',{get Overlayer(){return Overlayer}})
