// Lector de PDF sobre PDF.js. Renderiza página a página en un <canvas>,
// con una capa de texto seleccionable encima, y expone gestos táctiles
// (swipe, tap en los bordes, doble-tap para zoom) pensados para móvil.
//
// Deliberadamente NO usa un <iframe>/visor nativo: PDF.js en modo "canvas
// por página" es lo que permite igualar el look & feel del resto de la app
// (misma UI de progreso, mismos gestos que en el lector de EPUB/MOBI).
//
// Which page is drawn, how it is fitted, adapted to a text mode, re-themed,
// restored, spoken, searched and captured is Rust (pdf_* in rust-ui); this
// class holds the reader's state, the PDF.js objects and the callbacks they
// invoke (listeners, observers and the handlers of a spoken source).

// Android WebViews may lag behind Chrome. Use Mozilla's official compatibility
// build in BOTH contexts so a missing Promise.try cannot strand the worker.
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs'
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'
import { TextLayer } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { measurePDFBookLength } from '../pdf-book-length.js'
import { attachSwipeNavigation } from '../gestures.js'
import { DEFAULT_READING_PREFERENCES, PDF_PAGE_FILTERS, READING_FONTS, READING_THEMES, normalizeReadingPreferences } from './reading-preferences.js'
import { hasUntrackedPDFImages, paintPDFTheme } from './pdf-page-theme.js'
import { renderedPageFilter, settlePageLayout, snapshotCanvas, snapshotDOMPage } from './page-snapshot.js'
import { prepareSnapshotPaperTones, sharePaperTone } from '../page-paper-tone.js'
import { registerPageRaster } from '../page-raster.js'
import { encodePdfCover } from './cover-encode.js'
import { mapTextLayer, mapTextNodes } from './speech-map.js'
import { speechHold } from './speech-hold.js'
import { clearPDFReflow, pdfImageRects, preparePDFReflow } from './pdf-reflow.js'
import { extractPDFText, mapPDFTextLayer } from './pdf-text.js'
import { readerUI } from './rust-ui-required.js'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

// A spoken source: the handlers the audiobook calls, over the state `q` they share.
function makeSource(s, page, first, layout) {
  const ui = readerUI(), q = ui.pdf_speech_begin(s, page, first)
  const source = {
    text:first.text, start:0, clear:() => ui.pdf_speech_clear(q), physicalPage:page,
    offsetAtPoint:(tapped, x, y) => ui.pdf_speech_offset(s, q, tapped, x, y),
    // Geometric paragraphs are real body text, including repeated dialogue.
    // No marginal header is confirmed by page-local layout alone: preserve
    // those paragraphs even when the legacy header-skipping option is on.
    ...(layout?.geometric || s.preferences.pdfMode === 'text' ? { headerRanges:Object.freeze([]) } : {}),
    highlight:(start, end) => ui.pdf_speech_highlight(s, q, start, end),
    follow:(start, end) => ui.pdf_speech_follow(s, q, source, start, end)
  }
  return { source, current:() => ui.pdf_speech_current(s, q) }
}
// The page prepared off screen becomes the visible one only when its voice starts.
function stage(s, source, q) {
  const ui = readerUI()
  source.isValid = () => ui.pdf_source_valid(s, q)
  source.activate = () => ui.pdf_source_activate(s, q)
  source.clear = () => ui.pdf_source_clear(s, q)
}
function detach(s, source, pdf, isActive) {
  source.isValid = () => s.doc === pdf && isActive()
  source.activate = () => source.isValid()
}

// What the Rust reader calls: PDF.js and the page pipelines, passed in rather than imported there.
const kit = {
  pdfjs:pdfjsLib, get TextLayer() { return TextLayer }, measurePDFBookLength, normalizeReadingPreferences, PDF_PAGE_FILTERS, READING_FONTS, READING_THEMES,
  hasUntrackedPDFImages, paintPDFTheme, renderedPageFilter, settlePageLayout, snapshotCanvas, snapshotDOMPage, prepareSnapshotPaperTones, sharePaperTone,
  registerPageRaster, encodePdfCover, mapTextLayer, mapTextNodes, clearPDFReflow, pdfImageRects, preparePDFReflow, extractPDFText, mapPDFTextLayer,
  lengthOptions:(s, pdf) => ({ isActive:() => s.doc === pdf }), makeSource, stage, detach
}

export class PdfReader {
  s = {
    owner:this, kit, container:undefined, loadingTask:undefined, doc:undefined, retainedCovers:new Map(), pageNum:1, baseScale:1, zoomed:false, canvas:undefined,
    textLayerEl:undefined, pageWrap:undefined, renderToken:0, onRelocate:() => {}, detachGestures:() => {}, preferences:{ ...DEFAULT_READING_PREFERENCES },
    reflow:undefined, renderState:undefined, stagedSpeech:undefined, speechRequest:0, speechBrowsing:false, speechDetached:false, speechCursor:null,
    speechReveal:null, renderReady:Promise.resolve(), renderRequest:undefined, pageText:'', resizeObserver:undefined, resizeTimer:undefined, layoutWidth:0,
    imageLayouts:new WeakMap(), snapshotToneState:undefined, lengthMetadata:undefined, textOffset:0, textHeight:0, scrollTimer:undefined, detachScroll:() => {}
  }

  open(container, arrayBuffer, options) {
    const s = this.s, ui = readerUI(), onUserNavigation = options?.onUserNavigation, onToggleChrome = options?.onToggleChrome
    return ui.pdf_open(s, container, arrayBuffer, options, {
      scroll:() => {
        const onScroll = () => ui.pdf_scrolled(s)
        const onWheel = event => { if (event.deltaX || event.deltaY) onUserNavigation?.() }
        container.addEventListener('scroll', onScroll, { passive:true })
        container.addEventListener('wheel', onWheel, { passive:true })
        return () => {
          container.removeEventListener('scroll', onScroll)
          container.removeEventListener('wheel', onWheel)
        }
      },
      gestures:() => attachSwipeNavigation(container, {
        ...speechHold(container.ownerDocument),
        onNext: () => { onUserNavigation?.(); return this.next() },
        onPrev: () => { onUserNavigation?.(); return this.prev() },
        onManualPan: () => onUserNavigation?.(),
        onToggleZoom: (x, y) => this.toggleZoom(x, y),
        onToggleChrome,
        // Enlarged PDFs must pan, rather than accidentally turn a page. Let the
        // browser supply its touch momentum and keep long-press selection native.
        canSwipe: () => s.preferences.pdfMode === 'text' || !s.zoomed && s.preferences.zoom <= 100,
        getMotionSurface: () => s.preferences.pdfMode === 'text' ? s.reflow : s.pageWrap
      }),
      resize:() => ui.pdf_resized(s)
    })
  }

  get pageCount() { return this.s.doc?.numPages ?? 0 }
  get currentPage() { return this.s.pageNum }

  goToPage(n, options) { return readerUI().pdf_go_to_page(this.s, n, options) }
  next(options) { return readerUI().pdf_next(this.s, options) }
  prev() { return readerUI().pdf_prev(this.s) }
  getLengthMetadata() { return readerUI().pdf_length(this.s) }
  toggleZoom(clientX, clientY) { return readerUI().pdf_toggle_zoom(this.s, clientX, clientY) }
  getSpeechText() { return readerUI().pdf_speech_text(this.s) }
  getSpeechSource(options) { return readerUI().pdf_speech_source(this.s, options) }
  browseSpeech() { readerUI().pdf_speech_browse(this.s) }
  stopSpeech() { readerUI().pdf_speech_stop(this.s) }
  returnToSpeech() { return readerUI().pdf_speech_return(this.s) }
  getNextSpeechSource(options) { return readerUI().pdf_next_speech(this.s, options) }
  getPageSnapshot(options) { return readerUI().pdf_snapshot(this.s, options) }
  search(query) { return readerUI().pdf_search(this.s, query) }
  getSelection() { return readerUI().pdf_selection() }
  applyPreferences(preferences) { return readerUI().pdf_apply_preferences(this.s, preferences) }
  /** Miniatura de la página 1 como Blob, para la portada de la estantería. */
  getCoverBlob(options) { return readerUI().pdf_cover(this.s, options) }
  close() { readerUI().pdf_close(this.s) }
}
