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
// What foliate_open.rs mounts a book with and foliate_members.rs answers the reader's members with. canSwipe (every
// pointer move), theme (every spoken sentence) and the snap guard (any number of arguments) stay arrows.
const kit = { attach:attachSwipeNavigation, hold:speechHold, SpeechCursor:FoliateSpeechCursor, pageBreaks:speechPageBreaks, readingCSS,
  announce:announceSpeechLayout, get Overlayer() { return Overlayer }, mapText:mapSpeechText, measure:measureBookLength, normalize:normalizeReadingPreferences,
  canSwipe:s => () => s.preferences.flow !== 'scrolled', theme:s => () => s.preferences.theme,
  guardSnap:(ui, s, snap) => (...args) => ui.foliate_snap_skipped(s) ? undefined : snap(...args) }

export class FoliateReader {
  s = { view:null, container:null, onRelocate:() => {}, detachGestures:() => {}, preferences:{ ...DEFAULT_READING_PREFERENCES }, documentGestures:[],
    skipSnapUntil:0, resizeObserver:undefined, resizeTimer:undefined, followTicket:0, followTurn:Promise.resolve(), pageTurn:Promise.resolve(),
    lengthMetadata:null, lastReaderStyles:null, speechCursor:null, turns:{ followPending:0, pageTurnPending:0 }, pageBoxChanged:false }

  /** Numeric queue state only; no book text, labels, DOM ranges or CFI. */
  get speechDiagnosticState() {
    const paginator = this.s.view?.renderer?.inhouseReadTurnDiagnostic
    return { ...this.s.turns, ...(paginator ? { paginator } : {}) }
  }
  get metadata() { return this.s.view?.book?.metadata ?? {} }
  get toc() { return this.s.view?.book?.toc ?? [] }
  /** Right-to-left books turn pages from the left edge. */
  get rtl() { return this.s.view?.book?.dir === 'rtl' }
  // Reached by every wheel tick and pan while the audiobook plays: no crossing.
  browseSpeech() { this.s.followTicket++; this.s.speechCursor?.browse() }
}
// Opening, turning, going to a place, the audiobook's doors, the marks of the view, the preferences, the cover and the
// cached length: rust-ui foliate_reader_method (foliate_members.rs); the `!` ones answer with the promise Rust returns.
rustMethods(FoliateReader,'foliate_reader_method',`!open !next !prev !goToFraction !goToCfi !goToTarget !returnToSpeech stopSpeech
 getNextSpeechSource !getSpeechText !getSpeechSource clearSearch addQuoteAnnotation removeQuoteAnnotation !applyPreferences !getCoverBlob getLengthMetadata`,kit)
// The page snapshot, search, selection and closing: rust-ui foliate_method (controller_methods.rs) over `this.s`.
rustMethods(FoliateReader,'foliate_method','getPageSnapshot search getSelection close',{snapshot:snapshotKit})
