// Punto único de entrada para abrir un libro: detecta el formato y delega
// en PdfReader o FoliateReader, exponiendo la misma interfaz mínima hacia
// el resto de la app (open/next/prev/close + evento de progreso), para que
// la UI del visor no necesite saber qué motor hay debajo.
//
// Which engine opens a book and how every question about it is answered is
// Rust (controller_* in rust-ui); this class holds the controller's state and
// the engine callback.

import { detectFormat, isSupported } from '../format-detect.js'
import { readerUI } from './rust-ui-required.js'

export class UnsupportedFormatError extends Error {}

// What the Rust controller calls: the detector, and the two engines loaded when a book needs them.
const kit = { detectFormat, isSupported, UnsupportedFormatError, loadPdf:() => import('./pdf-reader.js'), loadFoliate:() => import('./foliate-reader.js') }

export class ReaderController {
  s = { owner:this, kit, engine:undefined, reader:undefined, format:undefined, location:{ fraction:0, locator:null }, epoch:0, speechPosition:null }

  open(container, file, options) {
    const s = this.s, ui = readerUI()
    return ui.controller_open(s, container, file, options, data => ui.controller_relocated(s, data, options?.onRelocate))
  }

  get format() { return this.s.format }
  /** Changes every time an engine is opened or closed: anything derived from the page of an earlier engine is stale. */
  get epoch() { return this.s.epoch }
  /** Metadatos del libro cuando el motor los expone (foliate); {} en PDF. */
  get metadata() { return readerUI().controller_metadata(this.s) }
  get location() { return this.s.location }
  /** Numeric native media progress; no text, CFI, credentials or persisted cursor changes. */
  get speechPosition() { return readerUI().controller_speech_position(this.s) }
  /** Diagnostic state for the native callback receipt; position remains read-only. */
  get speechDiagnosticState() { return readerUI().controller_diagnostic(this.s) }
  get rtl() { return Boolean(this.s.reader?.rtl) }
  get language() { return readerUI().controller_language(this.s) }
  get toc() { return readerUI().controller_toc(this.s) }
  goToTarget(target) { return readerUI().controller_go_to_target(this.s, target) }
  applyPreferences(preferences) { return readerUI().controller_apply_preferences(this.s, preferences) }
  getSpeechText() { return readerUI().controller_speech_text(this.s) }
  /** Text plus the mapping the audiobook needs to highlight and follow each sentence; null when the engine has none. */
  getSpeechSource(options) { return readerUI().controller_speech_source(this.s, options) }
  browseSpeech() { readerUI().controller_browse_speech(this.s) }
  returnToSpeech() { return readerUI().controller_return_to_speech(this.s) }
  stopSpeech() { readerUI().controller_stop_speech(this.s) }
  /** undefined keeps legacy format navigation; null from a supported reader identifies the actual book end. */
  get getNextSpeechSource() { return readerUI().controller_next_source(this.s) }
  getPageSnapshot(options) { return readerUI().controller_page_snapshot(this.s, options) }
  search(query) { return readerUI().controller_search(this.s, query) }
  clearSearch() { readerUI().controller_clear_search(this.s) }
  getSelection() { return readerUI().controller_selection(this.s) }
  addQuoteAnnotation(quote) { readerUI().controller_quote(this.s, true, quote) }
  removeQuoteAnnotation(quote) { readerUI().controller_quote(this.s, false, quote) }
  /** Portada como Blob: miniatura de la página 1 en PDF, embebida en EPUB/MOBI. */
  getCoverBlob(options) { return readerUI().controller_cover(this.s, options) }
  /** A stale background count cannot be attributed to a subsequently opened book. */
  getLengthMetadata() { return readerUI().controller_length(this.s) }
  /**
   * Número de páginas reales, solo cuando el formato lo tiene de verdad
   * (PDF). EPUB/MOBI son texto reflowable sin un "número de página" fijo
   * independiente del tamaño de pantalla/fuente, así que devuelve null en
   * vez de inventar un número. getLengthMetadata cuenta su texto aparte para
   * estimar el papel de su lomo sin depender de la paginación en pantalla.
   */
  get pageCount() { return readerUI().controller_page_count(this.s) }
  next(options) { return readerUI().controller_next(this.s, options) }
  prev() { return readerUI().controller_prev(this.s) }
  goToFraction(fraction) { return readerUI().controller_go_to_fraction(this.s, fraction) }
  goToLocator(locator, fallbackFraction) { return readerUI().controller_go_to_locator(this.s, locator, fallbackFraction) }
  close() { readerUI().controller_close(this.s) }
}
