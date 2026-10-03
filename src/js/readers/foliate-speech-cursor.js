// Audiobook chapter text must not wait for a hidden WebView to navigate an
// iframe. Foliate's own detached documents and CFI parser provide the same
// source text and exact saved position; rendering is only needed on return.
import { SectionProgress } from 'foliate-js/progress.js'
import { mapSpeechText } from './speech-map.js'
import { SPEECH_HIGHLIGHT, clearSpeechRange, installSpeechStyle, paintSpeechRange, speechOverlayColor } from './speech-highlight.js'
import { Overlayer } from 'foliate-js/overlayer.js'

const cancelled = () => new DOMException('Speech preparation cancelled', 'AbortError')
const sectionIndex = view => Number.isInteger(view.lastLocation?.index) ? view.lastLocation.index : view.lastLocation?.section?.current

export class FoliateSpeechCursor {
  constructor(view, { env = document, onRelocate = () => {}, theme = () => 'light' } = {}) {
    Object.assign(this, { view, env, onRelocate, theme })
    this.book = view.book
    this.epoch = 0
    this.current = null
    this.revealing = null
    this.closed = false
    this.progress = new SectionProgress(this.book?.sections || [], 1500, 1600)
    this.onVisibility = () => { if (!env.hidden) void this.reveal().catch(() => {}) }
    env.addEventListener('visibilitychange', this.onVisibility)
  }
  get detached() { return Boolean(this.current?.detached) }
  get active() { return Boolean(this.current) }
  valid() { return !this.closed && this.view.book === this.book }
  reset() { ++this.epoch; this.current = null }
  close() { this.reset(); this.closed = true; this.env.removeEventListener('visibilitychange', this.onVisibility) }

  // Attach a precise logical position to the chapter already on screen.
  // Its ordinary page cuts/highlighting remain in use while visible.
  wrap(source, map, index) {
    const highlight = source.highlight, follow = source.follow, clear = source.clear
    const state = { source, map, index, epoch:this.epoch, detached:false, offset:source.start || 0, sentence:null, cfi:null }
    source.highlight = (start, end) => {
      if (this.env.hidden || this.current === state) state.sentence = [start, end]
      if (!this.env.hidden) highlight?.(start, end)
    }
    source.follow = (start, end) => {
      if (this.env.hidden || this.current === state) {
        this.remember(state, start, end)
        if (!this.env.hidden) return this.reveal()
        return
      }
      return follow?.(start, end)
    }
    source.clear = () => { state.sentence = null; clear?.() }
    return source
  }

  remember(state, start, end) {
    if (!this.valid() || state.epoch !== this.epoch) return
    const range = state.map.rangeFor(start, end)
    if (!range) return
    const point = range.cloneRange(); point.collapse(true)
    state.cfi = this.view.getCFI(state.index, point)
    state.offset = start
    this.current = state
    const fraction = this.progress.getProgress(state.index, start / Math.max(1, state.map.text.length)).fraction
    this.onRelocate({ index:state.index, cfi:state.cfi,
      ...(Number.isFinite(fraction) ? { fraction } : {}), section:'', page:'' })
  }

  async next({ isActive = () => true } = {}) {
    if (!this.env.hidden) return undefined
    const previous = this.current, epoch = this.epoch
    let index = previous?.index ?? sectionIndex(this.view)
    // Image spreads and unsupported extractors retain the existing reader path.
    if (!Number.isInteger(index) || this.book?.rendition?.layout === 'pre-paginated') return undefined
    const valid = () => this.valid() && this.epoch === epoch && this.current === previous && isActive()
    for (++index; index < this.book.sections.length; index++) {
      if (!valid()) throw cancelled()
      const section = this.book.sections[index]
      if (section.linear === 'no') continue
      if (typeof section.createDocument !== 'function') return undefined
      const doc = await section.createDocument()
      if (!valid()) throw cancelled()
      const root = doc?.body || doc?.querySelector('body')
      if (!root) throw new Error('El capítulo no contiene texto legible.')
      const map = mapSpeechText(root)
      if (!map.text.trim()) continue
      let activated = false
      const source = { text:map.text, start:0 }
      const state = { source, map, index, epoch, detached:true, offset:0, sentence:null, cfi:null }
      source.isValid = () => activated ? this.valid() && this.current === state : valid()
      source.activate = () => {
        if (activated) return source.isValid()
        if (!valid()) return false
        activated = true
        this.current = state
        return true
      }
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
    if (!valid()) throw cancelled()
    return null
  }

  currentSource() {
    const state = this.current
    return state ? { ...state.source, start:state.offset } : null
  }

  // Only the most recent audible CFI is shown. No timers, page animation or
  // rendering promise is used as a prerequisite for synthesis/playback.
  reveal() {
    if (!this.valid() || this.env.hidden || !this.current?.cfi) return Promise.resolve()
    if (this.revealing) return this.revealing
    const epoch = this.epoch
    const work = async () => {
      let displayed
      while (this.valid() && epoch === this.epoch && !this.env.hidden && this.current?.cfi && this.current.cfi !== displayed) {
        const state = this.current, cfi = state.cfi
        await this.view.goTo(cfi)
        if (!this.valid() || epoch !== this.epoch || this.env.hidden) return
        displayed = cfi
        if (this.current !== state || state.cfi !== cfi) continue
        const content = this.view.renderer?.getContents?.().find(item => item.index === state.index)
        if (!content?.doc || !state.sentence) continue
        const range = state.map.rangeFor(...state.sentence)
        if (!range) continue
        const sentence = this.view.resolveCFI(this.view.getCFI(state.index, range))?.anchor?.(content.doc)
        if (!sentence) continue
        installSpeechStyle(content.doc, this.theme())
        clearSpeechRange(content.doc)
        if (!paintSpeechRange(sentence)) content.overlayer?.add(SPEECH_HIGHLIGHT, sentence, Overlayer.highlight, { color:speechOverlayColor(this.theme()) })
      }
    }
    const promise = work().finally(() => { if (this.revealing === promise) this.revealing = null })
    this.revealing = promise
    return promise
  }
}
