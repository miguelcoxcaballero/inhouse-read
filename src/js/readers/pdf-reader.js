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
import { pdfImagePaths } from './pdf-images-wasm.js'
import { renderedPageFilter, settlePageLayout, snapshotCanvas, snapshotDOMPage } from './page-snapshot.js'
import { prepareSnapshotPaperTones, sharePaperTone } from '../page-paper-tone.js'
import { registerPageRaster } from '../page-raster.js'
import { encodePdfCover } from './cover-encode.js'
import { mapTextLayer, mapTextNodes } from './speech-map.js'
import { speechHold } from './speech-hold.js'
import { pdfPlaceFigures } from './pdf-figures-wasm.js'
import { pdfImageRects } from './pdf-reflow.js'
import { extractPDFText, mapPDFTextLayer } from './pdf-text.js'
import { readerUI, rustMethods } from './rust-ui-required.js'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

// What the Rust reader calls: PDF.js and the page pipelines, passed in rather than imported there.
const kit = {
  pdfjs:pdfjsLib, get TextLayer() { return TextLayer }, measurePDFBookLength, normalizeReadingPreferences, PDF_PAGE_FILTERS, READING_FONTS, READING_THEMES,
  pdfImagePaths, renderedPageFilter, settlePageLayout, snapshotCanvas, snapshotDOMPage, prepareSnapshotPaperTones, sharePaperTone,
  registerPageRaster, encodePdfCover, mapTextLayer, mapTextNodes, pdfPlaceFigures, pdfImageRects, extractPDFText, mapPDFTextLayer,
  lengthOptions:(s, pdf) => ({ isActive:() => s.doc === pdf }), get ui() { return readerUI() },
  // The open hooks (rust-ui pdf_hooks, reader_assembly.rs) keep arrows for what runs on every pointer move or wheel event.
  attach:attachSwipeNavigation, hold:speechHold, wheel:onUserNavigation => event => { if (event.deltaX || event.deltaY) onUserNavigation?.() },
  canSwipe:s => () => s.preferences.pdfMode === 'text' || !s.zoomed && s.preferences.zoom <= 100,
  motionSurface:s => () => s.preferences.pdfMode === 'text' ? s.reflow : s.pageWrap
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
    const ui = readerUI()
    return ui.pdf_open(this.s, container, arrayBuffer, options, ui.pdf_hooks(this, this.s, container, options, kit, ui))
  }

  get pageCount() { return this.s.doc?.numPages ?? 0 }
  get currentPage() { return this.s.pageNum }
}
// Methods answered by rust-ui pdf_method (controller_methods.rs) over `this.s`; getCoverBlob is page 1's thumbnail.
rustMethods(PdfReader,'pdf_method',`goToPage next prev getLengthMetadata toggleZoom getSpeechText getSpeechSource browseSpeech stopSpeech
 returnToSpeech getNextSpeechSource getPageSnapshot search getSelection applyPreferences getCoverBlob close`)
