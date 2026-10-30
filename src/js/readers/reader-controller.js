// Punto único de entrada para abrir un libro: detecta el formato y delega
// en PdfReader o FoliateReader, exponiendo la misma interfaz mínima hacia
// el resto de la app (open/next/prev/close + evento de progreso), para que
// la UI del visor no necesite saber qué motor hay debajo.
//
// Which engine opens a book and how every question about it is answered is
// Rust (controller_* in rust-ui); this class holds the controller's state and
// the engine callback.

import { detectFormat, isSupported } from '../format-detect.js'
import { readerUI, rustMethods } from './rust-ui-required.js'

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
  get location() { return this.s.location }
  get rtl() { return Boolean(this.s.reader?.rtl) }
}
// Getters (.name) and methods answered by rust-ui controller_methods.rs over `this.s`.
rustMethods(ReaderController,'controller_method',`.metadata .speechPosition .speechDiagnosticState .language .toc .getNextSpeechSource .pageCount
 goToTarget applyPreferences getSpeechText getSpeechSource browseSpeech returnToSpeech stopSpeech getPageSnapshot search clearSearch getSelection
 addQuoteAnnotation removeQuoteAnnotation getCoverBlob getLengthMetadata next prev goToFraction goToLocator close`)
