// Lector de EPUB / MOBI / AZW3 / FB2 / CBZ sobre foliate-js. La librería
// expone un custom element <foliate-view> que se encarga de paginar (vía
// columnas CSS) y renderizar cada sección; nosotros solo lo montamos,
// aplicamos nuestros propios tokens de estilo dentro de su shadow DOM, y
// traducimos sus eventos a la misma interfaz que usa el lector de PDF.
//
// Nota de honestidad (ver README.md → "Limitaciones honestas"): el soporte de MOBI/AZW3 de
// foliate-js es funcional pero no tan maduro como su soporte de EPUB, y no
// puede abrir archivos con DRM de Amazon (limitación criptográfica, no de
// la librería). Ver también la investigación en el propio HANDOFF.
//
// How a page is laid out, turned, followed, spoken and captured is Rust
// (foliate_* in rust-ui); this class holds the reader's state, the foliate
// objects and the callbacks they invoke.

import 'foliate-js/view.js'
import { Overlayer } from 'foliate-js/overlayer.js'
import { attachSwipeNavigation } from '../gestures.js'
import { DEFAULT_READING_PREFERENCES, readingCSS, normalizeReadingPreferences } from './reading-preferences.js'
import { READING_THEMES } from './reading-preferences.js'
import { compositePageSnapshots, renderedPageFilter, settlePageLayout, snapshotDOMPage } from './page-snapshot.js'
import { mapSpeechText } from './speech-map.js'
import { speechPageBreaks } from './speech-page-breaks.js'
import { speechHold } from './speech-hold.js'
import { FoliateSpeechCursor } from './foliate-speech-cursor.js'
import { measureBookLength } from '../book-length.js'
import { readerUI } from './rust-ui-required.js'

// Tells the audiobook that pages broke anew (see ReadingVoice.refreshPageBreaks),
// once the paginator has laid the chapter out again.
let speechLayoutTimer = 0
export function announceSpeechLayout() {
  clearTimeout(speechLayoutTimer)
  speechLayoutTimer = setTimeout(() => window.dispatchEvent(new CustomEvent('inhouse-speech-layout')), 350)
}

// foliate marca las coincidencias de búsqueda con Overlayer.outline (un
// recuadro rojo de 3px que parecía una capa de depuración). Lo sustituimos una
// vez por un resaltado ámbar de rotulador, suave en los cinco temas de lectura.
Overlayer.outline = (rects, options) => readerUI().foliate_outline(rects, options)

const snapshotKit = { settlePageLayout, renderedPageFilter, snapshotDOMPage, compositePageSnapshots, themes:READING_THEMES }

export class FoliateReader {
  s = { view:null, container:null, onRelocate:() => {}, detachGestures:() => {}, preferences:{ ...DEFAULT_READING_PREFERENCES }, documentGestures:[],
    skipSnapUntil:0, resizeObserver:undefined, resizeTimer:undefined, followTicket:0, followTurn:Promise.resolve(), pageTurn:Promise.resolve(),
    lengthMetadata:null, lastReaderStyles:null, speechCursor:null, turns:{ followPending:0, pageTurnPending:0 }, pageBoxChanged:false }

  async open(container, file, { onRelocate, onToggleChrome, onUserNavigation, onFollowLink } = {}) {
    const s = this.s, ui = readerUI(), view = ui.foliate_attach(s, container, onRelocate ?? (() => {}))
    // foliate-js es deliberadamente de bajo nivel y no trae gestos táctiles
    // propios (ver HANDOFF-FORMATOS.md): reusamos el mismo detector de
    // swipe/tap que el lector de PDF para que la sensación táctil sea
    // idéntica entre formatos.
    const gestures = {
      onNext: () => { onUserNavigation?.(); ui.foliate_skip_snap(s); return this.next() },
      onPrev: () => { onUserNavigation?.(); ui.foliate_skip_snap(s); return this.prev() },
      onToggleChrome,
      // Foliate already tracks touch drag/velocity and snaps to the next page.
      // A second pointerup navigation here used to advance twice per swipe.
      nativeTouchSwipes:true,
      onNativeSwipe:() => { onUserNavigation?.(); if (!s.speechCursor?.browsing) s.speechCursor?.reset() },
      onManualPan:() => { if (s.preferences.flow === 'scrolled') onUserNavigation?.() },
      canSwipe:() => s.preferences.flow !== 'scrolled'
    }
    s.detachGestures = attachSwipeNavigation(container, gestures)
    const tapZone = event => ui.foliate_tap_zone(s, event)
    view.addEventListener('load', event => {
      // Events inside the book iframe do not bubble to the outer viewport.
      const doc = event.detail.doc
      s.documentGestures.push(attachSwipeNavigation(doc.documentElement, { ...gestures, ...speechHold(doc), tapZone }))
      doc.addEventListener('selectionchange', () => ui.foliate_selected(s, event.detail))
    })
    view.addEventListener('link', event => {
      if (onFollowLink) { event.preventDefault(); onFollowLink(event.detail.href) }
    })
    view.addEventListener('draw-annotation', event => {
      const { draw, annotation } = event.detail
      const colors = { green:'#75ad6b66', blue:'#74a6d866', pink:'#df8dad66', yellow:'#f2d35d77' }
      draw(Overlayer.highlight, { color:colors[annotation.color] || colors.yellow })
    })
    view.addEventListener('relocate', event => ui.foliate_relocated(s, event.detail))

    await view.open(file)
    const renderer = view.renderer, snap = renderer?.snap?.bind(renderer)
    if (snap) renderer.snap = (...args) => ui.foliate_snap_skipped(s) ? undefined : snap(...args)
    // Configure the paginator before the first page is laid out. Its defaults
    // reserve 48 px above/below the text even though our chrome has its own
    // space. The first visible page must use the same geometry as later pages.
    this.#layout()
    this.#styles()
    await view.init({ showTextStart: true })
    s.speechCursor = new FoliateSpeechCursor(view, { onRelocate:s.onRelocate, theme:() => s.preferences.theme })
    if (typeof ResizeObserver !== 'undefined') {
      s.resizeObserver = new ResizeObserver(() => {
        clearTimeout(s.resizeTimer)
        s.resizeTimer = setTimeout(() => this.#layout(), 80)
      })
      s.resizeObserver.observe(container)
    }
  }

  #layout() { readerUI().foliate_layout(this.s, announceSpeechLayout) }
  #styles() { readerUI().foliate_styles(this.s, readingCSS) }

  /** Numeric queue state only; no book text, labels, DOM ranges or CFI. */
  get speechDiagnosticState() {
    const paginator = this.s.view?.renderer?.inhouseReadTurnDiagnostic
    return { ...this.s.turns, ...(paginator ? { paginator } : {}) }
  }
  get metadata() { return this.s.view?.book?.metadata ?? {} }
  get toc() { return this.s.view?.book?.toc ?? [] }
  /** Right-to-left books turn pages from the left edge. */
  get rtl() { return this.s.view?.book?.dir === 'rtl' }

  /** Portada embebida del libro (EPUB/MOBI), si el archivo trae una. */
  async getCoverBlob() {
    try { return (await this.s.view?.book?.getCover?.()) ?? null }
    catch { return null } // una portada rota no puede impedir leer el libro
  }

  /** Cached physical-length metadata, counted outside the visible paginator. */
  getLengthMetadata() {
    const s = this.s, view = s.view, book = view?.book
    if (!book) return Promise.resolve(null)
    return s.lengthMetadata ??= measureBookLength(book, { isActive:() => view === s.view && book === view.book })
  }

  async next({ isActive = () => true } = {}) { await readerUI().foliate_turn(this.s, 'next', isActive) }
  async prev() { await readerUI().foliate_turn(this.s, 'prev', () => true) }

  async goToFraction(fraction) {
    if (!this.s.speechCursor?.browsing) this.s.speechCursor?.reset()
    await this.s.view?.goToFraction(fraction)
  }
  async goToCfi(cfi) {
    if (!this.s.speechCursor?.browsing) this.s.speechCursor?.reset()
    if (cfi) await this.s.view?.goTo(cfi)
  }
  async goToTarget(target) { if (!this.s.speechCursor?.browsing) this.s.speechCursor?.reset(); await this.s.view?.goTo(target) }
  browseSpeech() { this.s.followTicket++; this.s.speechCursor?.browse() }
  async returnToSpeech() { await this.s.speechCursor?.returnToSpeech() }
  stopSpeech() { this.s.speechCursor?.reset() }
  getNextSpeechSource(options) { return this.s.speechCursor?.next(options) }
  async getSpeechText() { return this.s.view?.lastLocation?.range?.toString() || '' }

  /**
   * The audiobook reads from the visible page to the end of its section, so a
   * sentence keeps one highlight across page breaks. Its audio fragments end
   * at actual page boundaries, so the next audible fragment turns the page.
   * Offsets index the returned text; the
   * DOM is only read (ranges for the highlight), never changed.
   */
  async getSpeechSource({ visible:visibleOnly = false } = {}) {
    const s = this.s, ui = readerUI(), prepared = await ui.foliate_speech_prepare(s, visibleOnly, mapSpeechText, speechPageBreaks)
    if (prepared.done) return prepared.value
    const { view, doc, map, content, pageBreaks, start } = prepared
    const live = () => ui.foliate_live(s, view, doc)
    const clear = () => ui.foliate_clear_speech(s, doc, content)
    const source = {
      text:map.text, start, pageBreaks, clear,
      highlight:(from, to) => ui.foliate_speech_highlight(s, live, map, content, clear, from, to, Overlayer.highlight),
      follow:(from, to) => live() ? ui.foliate_follow(s, doc, map.rangeFor(from, to)) : undefined,
      // The text offset under a tap on this chapter, for ReadingVoice.jumpToPoint().
      offsetAtPoint:(tapped, x, y) => ui.foliate_offset_at_point(live, tapped, doc, map, x, y),
      // Measured again after a relayout: see ReadingVoice.refreshPageBreaks().
      measurePageBreaks:() => live() && !document.hidden ? speechPageBreaks(map, view.renderer, { isCurrent:live }) : Promise.resolve(null)
    }
    // Web fonts arriving after the cuts were measured move lines between pages.
    if (doc.fonts && doc.fonts.status !== 'loaded') void doc.fonts.ready.then(() => announceSpeechLayout())
    return s.speechCursor?.wrap(source, map, content.index) || source
  }

  /** Snapshot the current paginated column/scroll viewport after CFI restore. */
  getPageSnapshot() { return readerUI().foliate_snapshot(this.s, snapshotKit) }
  search(query) { return readerUI().foliate_search(this.s, query) }
  clearSearch() { this.s.view?.clearSearch?.() }
  getSelection() { return readerUI().foliate_selection(this.s) }
  addQuoteAnnotation(quote) { if (quote?.locator?.kind === 'cfi') this.s.view?.addAnnotation?.({ value:quote.locator.value, color:quote.color }) }
  removeQuoteAnnotation(quote) { if (quote?.locator?.kind === 'cfi') this.s.view?.deleteAnnotation?.({ value:quote.locator.value }) }
  async applyPreferences(preferences) {
    this.s.preferences = normalizeReadingPreferences(preferences)
    this.#layout()
    this.#styles()
  }

  close() {
    const s = this.s
    s.speechCursor?.close()
    s.speechCursor = null
    s.lengthMetadata = null
    s.resizeObserver?.disconnect()
    s.resizeObserver = null
    clearTimeout(s.resizeTimer)
    s.resizeTimer = null
    s.detachGestures()
    for (const detach of s.documentGestures) detach()
    s.documentGestures = []
    s.view?.close()
    s.view?.remove()
    s.view = null
    s.turns = { followPending:0, pageTurnPending:0 }
    s.pageTurn = Promise.resolve()
    if (s.container) { s.container.innerHTML = ''; s.container.classList.remove('foliate-reader', 'is-paginated') }
  }
}
