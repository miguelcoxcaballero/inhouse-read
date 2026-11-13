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
import { readerUI, rustMethods } from './rust-ui-required.js'

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
// What foliate_open.rs mounts a book with. canSwipe (every pointer move), theme (every spoken sentence) and the snap
// guard (any number of arguments) stay arrows.
const kit = { attach:attachSwipeNavigation, hold:speechHold, SpeechCursor:FoliateSpeechCursor, pageBreaks:speechPageBreaks, readingCSS,
  announce:announceSpeechLayout, get Overlayer() { return Overlayer },
  canSwipe:s => () => s.preferences.flow !== 'scrolled', theme:s => () => s.preferences.theme,
  guardSnap:(ui, s, snap) => (...args) => ui.foliate_snap_skipped(s) ? undefined : snap(...args) }

export class FoliateReader {
  s = { view:null, container:null, onRelocate:() => {}, detachGestures:() => {}, preferences:{ ...DEFAULT_READING_PREFERENCES }, documentGestures:[],
    skipSnapUntil:0, resizeObserver:undefined, resizeTimer:undefined, followTicket:0, followTurn:Promise.resolve(), pageTurn:Promise.resolve(),
    lengthMetadata:null, lastReaderStyles:null, speechCursor:null, turns:{ followPending:0, pageTurnPending:0 }, pageBoxChanged:false }

  async open(container, file, { onRelocate, onToggleChrome, onUserNavigation, onFollowLink } = {}) {
    const s = this.s, ui = readerUI(), view = ui.foliate_open(this, s, container, onRelocate, onToggleChrome, onUserNavigation, onFollowLink, kit, ui)
    await view.open(file)
    ui.foliate_opened(s, view, kit, ui)
    await view.init({ showTextStart: true })
    ui.foliate_ready(s, view, container, kit, ui)
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

  async goToFraction(fraction) { readerUI().foliate_reset_cursor(this.s); await this.s.view?.goToFraction(fraction) }
  async goToCfi(cfi) { readerUI().foliate_reset_cursor(this.s); if (cfi) await this.s.view?.goTo(cfi) }
  async goToTarget(target) { readerUI().foliate_reset_cursor(this.s); await this.s.view?.goTo(target) }
  browseSpeech() { this.s.followTicket++; this.s.speechCursor?.browse() }
  async returnToSpeech() { await this.s.speechCursor?.returnToSpeech() }
  stopSpeech() { this.s.speechCursor?.reset() }
  getNextSpeechSource(options) { return this.s.speechCursor?.next(options) }
  async getSpeechText() { return this.s.view?.lastLocation?.range?.toString() || '' }

  // The source's handlers: rust-ui foliate_speech_source (foliate_open.rs).
  async getSpeechSource({ visible:visibleOnly = false } = {}) {
    const ui = readerUI(), prepared = await ui.foliate_speech_prepare(this.s, visibleOnly, mapSpeechText, speechPageBreaks)
    return prepared.done ? prepared.value : ui.foliate_speech_source(this.s, prepared, kit, ui)
  }

  clearSearch() { this.s.view?.clearSearch?.() }
  addQuoteAnnotation(quote) { if (quote?.locator?.kind === 'cfi') this.s.view?.addAnnotation?.({ value:quote.locator.value, color:quote.color }) }
  removeQuoteAnnotation(quote) { if (quote?.locator?.kind === 'cfi') this.s.view?.deleteAnnotation?.({ value:quote.locator.value }) }
  async applyPreferences(preferences) {
    this.s.preferences = normalizeReadingPreferences(preferences)
    this.#layout()
    this.#styles()
  }

}
// The page snapshot, search, selection and closing: rust-ui foliate_method (controller_methods.rs) over `this.s`.
rustMethods(FoliateReader,'foliate_method','getPageSnapshot search getSelection close',{snapshot:snapshotKit})
