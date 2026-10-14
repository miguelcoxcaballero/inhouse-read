// Lector de PDF sobre PDF.js. Renderiza página a página en un <canvas>,
// con una capa de texto seleccionable encima, y expone gestos táctiles
// (swipe, tap en los bordes, doble-tap para zoom) pensados para móvil.
//
// Deliberadamente NO usa un <iframe>/visor nativo: PDF.js en modo "canvas
// por página" es lo que permite igualar el look & feel del resto de la app
// (misma UI de progreso, mismos gestos que en el lector de EPUB/MOBI).

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
import { SPEECH_SPAN_CLASS, clearSpeechRange, installSpeechStyle, paintSpeechRange } from './speech-highlight.js'
import { speechFollowOffset } from './speech-follow.js'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

const ZOOM_STEP_SCALE = 2.2
const MAX_EMPTY_SPEECH_PAGES = 12
const speechCancelled = () => new DOMException('La preparación de la página ha cambiado.', 'AbortError')

export class PdfReader {
  s = {
    container:undefined, loadingTask:undefined, doc:undefined, retainedCovers:new Map(), pageNum:1, baseScale:1, zoomed:false, canvas:undefined,
    textLayerEl:undefined, pageWrap:undefined, renderToken:0, onRelocate:() => {}, detachGestures:() => {}, preferences:{ ...DEFAULT_READING_PREFERENCES },
    reflow:undefined, renderState:undefined, stagedSpeech:undefined, speechRequest:0, speechBrowsing:false, speechDetached:false, speechCursor:null,
    speechReveal:null, renderReady:Promise.resolve(), renderRequest:undefined, pageText:'', resizeObserver:undefined, resizeTimer:undefined, layoutWidth:0,
    imageLayouts:new WeakMap(), snapshotToneState:undefined, lengthMetadata:undefined, textOffset:0, textHeight:0, scrollTimer:undefined, detachScroll:() => {}
  }

  async open(container, arrayBuffer, { onRelocate, onToggleChrome, onUserNavigation, initialPage, initialLocator, initialFraction = 0, preferences } = {}) {
    this.s.container = container
    this.s.onRelocate = onRelocate ?? (() => {})

    const loading = this.s.loadingTask = pdfjsLib.getDocument({ data: arrayBuffer })
    const pdf = await loading.promise
    if (loading !== this.s.loadingTask) return
    this.s.doc = pdf
    this.s.lengthMetadata = null
    this.s.textOffset = 0
    this.s.zoomed = false
    if (preferences) this.s.preferences = normalizeReadingPreferences(preferences)

    container.innerHTML = ''
    container.classList.add('pdf-reader')
    container.classList.remove('foliate-reader')

    this.s.pageWrap = document.createElement('div')
    this.s.pageWrap.className = 'pdf-page-wrap'
    this.s.canvas = document.createElement('canvas')
    this.s.canvas.className = 'pdf-page-canvas'
    this.s.textLayerEl = document.createElement('div')
    this.s.textLayerEl.className = 'pdf-text-layer'

    this.s.pageWrap.append(this.s.canvas, this.s.textLayerEl)
    container.append(this.s.pageWrap)
    this.s.reflow = document.createElement('article')
    this.s.reflow.className = 'pdf-reflow-page'
    this.s.reflow.hidden = true
    container.append(this.s.reflow)
    this.#applyTextStyles()
    const onScroll = () => {
      if (!this.s.doc || this.s.preferences.pdfMode !== 'text') return
      clearTimeout(this.s.scrollTimer)
      this.s.scrollTimer = setTimeout(() => this.#rememberTextPosition(), 150)
    }
    container.addEventListener('scroll', onScroll, { passive:true })
    const onWheel = event => { if (event.deltaX || event.deltaY) onUserNavigation?.() }
    container.addEventListener('wheel', onWheel, { passive:true })
    this.s.detachScroll = () => {
      container.removeEventListener('scroll', onScroll)
      container.removeEventListener('wheel', onWheel)
    }

    this.s.detachGestures = attachSwipeNavigation(container, {
      ...speechHold(container.ownerDocument),
      onNext: () => { onUserNavigation?.(); return this.next() },
      onPrev: () => { onUserNavigation?.(); return this.prev() },
      onManualPan: () => onUserNavigation?.(),
      onToggleZoom: (x, y) => this.toggleZoom(x, y),
      onToggleChrome,
      // Enlarged PDFs must pan, rather than accidentally turn a page. Let the
      // browser supply its touch momentum and keep long-press selection native.
      canSwipe: () => this.s.preferences.pdfMode === 'text'
        || !this.s.zoomed && this.s.preferences.zoom <= 100,
      getMotionSurface: () => this.s.preferences.pdfMode === 'text' ? this.s.reflow : this.s.pageWrap
    })

    await this.goToPage(initialPage ?? (initialLocator?.kind === 'pdf-page' ? initialLocator.value : undefined)
      ?? Math.round((Number(initialFraction) || 0) * (pdf.numPages - 1)) + 1, { textOffset:initialLocator?.textOffset })
    if (loading !== this.s.loadingTask) return
    // The reader lives inside the actual usable viewport. A phone rotation,
    // split view or browser resize must refit both pixels and selection, without
    // treating that layout change as navigation or losing the saved page.
    if (typeof ResizeObserver !== 'undefined') {
      this.s.resizeObserver = new ResizeObserver(() => this.#onResize())
      this.s.resizeObserver.observe(container)
    }
  }

  get pageCount() {
    return this.s.doc?.numPages ?? 0
  }

  get currentPage() {
    return this.s.pageNum
  }

  async goToPage(n, { textOffset = 0, edge } = {}) {
    if (!this.s.doc) return
    this.#cancelResize()
    this.#invalidateStagedSpeech()
    const clamped = Math.min(Math.max(1, Math.round(Number(n) || 1)), this.s.doc.numPages)
    this.s.pageNum = clamped
    const rendered = await this.#render()
    if (!rendered || this.s.pageNum !== clamped) return
    this.#cancelResize()
    clearTimeout(this.s.scrollTimer)
    this.s.container.scrollTop = edge === 'end' && this.s.preferences.pdfMode === 'text'
      ? Math.max(0, this.s.container.scrollHeight - this.s.container.clientHeight) : 0
    this.s.textOffset = Math.min(this.s.pageText.length, Number.isFinite(Number(textOffset)) ? Math.max(0, Math.trunc(Number(textOffset))) : 0)
    if (edge === 'end') this.s.textOffset = this.#visibleTextOffset()
    else this.#restoreTextOffset(this.s.textOffset)
    this.#emitLocation()
  }

  async next({ source = false, isActive } = {}) {
    if (!this.s.doc || isActive?.() === false) return
    // The voice has already read the entire physical page. Manual navigation
    // instead traverses every screen of an adaptable page before leaving it.
    if (!source && this.#moveTextViewport(1)) return
    if (this.s.pageNum < this.pageCount) await this.goToPage(this.s.pageNum + 1)
  }

  async prev() {
    if (!this.s.doc || this.#moveTextViewport(-1)) return
    if (this.s.pageNum > 1) await this.goToPage(this.s.pageNum - 1, { edge:'end' })
  }

  #moveTextViewport(direction) {
    if (this.s.preferences.pdfMode !== 'text') return false
    this.#settleTextResize()
    const height = this.s.container.clientHeight
    if (!(height > 0)) return false
    const end = Math.max(0, this.s.container.scrollHeight - height)
    const current = Math.min(end, Math.max(0, this.s.container.scrollTop))
    if (direction > 0 ? current >= end - 1 : current <= 1) return false
    // One line of overlap makes words on a viewport boundary readable in full.
    const line = Math.ceil(this.s.preferences.fontSize * this.s.preferences.lineHeight)
    const top = Math.min(end, Math.max(0, current + direction * Math.max(1, height - line)))
    this.s.container.scrollTo({ top, behavior:'instant' })
    this.#rememberTextPosition()
    return true
  }

  #visibleTextOffset() {
    const map = mapTextNodes(this.s.reflow), doc = this.s.reflow?.ownerDocument
    if (this.s.preferences.pdfMode !== 'text' || !map.text || !doc?.createRange) return this.s.textOffset
    const edge = this.s.container.getBoundingClientRect().top
    const range = doc.createRange()
    if (typeof range.getClientRects !== 'function') return this.s.textOffset
    let low = 0, high = map.text.length
    while (low < high) {
      const middle = (low + high) >>> 1
      const rect = map.rangeFor(middle,middle + 1)?.getClientRects()[0]
      if (!rect || rect.bottom <= edge + 1) low = middle + 1
      else high = middle
    }
    return Math.min(map.text.length, low)
  }

  #restoreTextOffset(offset) {
    if (this.s.preferences.pdfMode !== 'text') return
    const map = mapTextNodes(this.s.reflow)
    this.s.textOffset = Math.min(map.text.length, Math.max(0, Math.trunc(Number(offset) || 0)))
    if (!map.text || !this.s.textOffset) return
    const range = map.rangeFor(Math.min(this.s.textOffset,map.text.length - 1),Math.min(this.s.textOffset + 1,map.text.length))
    const rect = range?.getClientRects?.()[0]
    if (rect) this.s.container.scrollTo({ top:this.s.container.scrollTop + rect.top - this.s.container.getBoundingClientRect().top, behavior:'instant' })
  }

  #rememberTextPosition() {
    if (!this.s.doc || this.s.preferences.pdfMode !== 'text' || this.s.reflow.hidden) return
    // A queued scroll event can arrive before ResizeObserver after rotation.
    // Those pixels belong to the new layout, not a new reading position.
    if (this.s.resizeTimer != null) return
    if (this.#textLayoutChanged()) { this.#onResize(); return }
    const offset = this.#visibleTextOffset()
    if (offset === this.s.textOffset) return
    this.s.textOffset = offset
    this.#emitLocation()
  }

  #textLayoutChanged() {
    return Math.abs(this.#containerWidth() - this.s.layoutWidth) >= 1 || this.s.container.clientHeight !== this.s.textHeight
  }

  #cancelResize() {
    clearTimeout(this.s.resizeTimer)
    this.s.resizeTimer = null
  }

  #settleTextResize() {
    if (!this.s.doc || this.s.preferences.pdfMode !== 'text' || this.s.resizeTimer == null && !this.#textLayoutChanged()) return
    this.#cancelResize()
    clearTimeout(this.s.scrollTimer)
    this.s.layoutWidth = this.#containerWidth(); this.s.textHeight = this.s.container.clientHeight
    this.#restoreTextOffset(this.s.textOffset)
  }

  #emitLocation() {
    if (!this.s.doc) return
    this.s.onRelocate({ index:this.s.pageNum - 1,
      fraction:(this.s.pageNum - 1) / Math.max(1, this.s.doc.numPages - 1),
      ...(this.s.textOffset > 0 ? { textOffset:this.s.textOffset } : {}) })
  }

  async getLengthMetadata() {
    const pdf = this.s.doc
    if (!pdf) return null
    if (this.s.lengthMetadata?.pdf !== pdf) {
      this.s.lengthMetadata = { pdf, promise:measurePDFBookLength(pdf, { isActive:() => this.s.doc === pdf }) }
    }
    const result = await this.s.lengthMetadata.promise
    return this.s.doc === pdf ? result : null
  }

  async toggleZoom(clientX, clientY) {
    if (!this.s.doc || this.s.preferences.pdfMode === 'text') return
    this.#invalidateStagedSpeech()
    const containerRect = this.s.container.getBoundingClientRect()
    const pageRect = this.s.canvas.getBoundingClientRect()
    const x = clientX ?? containerRect.left + containerRect.width / 2
    const y = clientY ?? containerRect.top + containerRect.height / 2
    const width = pageRect.width || parseFloat(this.s.canvas.style.width)
    const height = pageRect.height || parseFloat(this.s.canvas.style.height)
    const focalX = Math.max(0, Math.min(1, (x - pageRect.left) / width))
    const focalY = Math.max(0, Math.min(1, (y - pageRect.top) / height))
    this.s.zoomed = !this.s.zoomed
    if (!await this.#render() || !this.s.doc) return
    // Keep the same printed point under the tap, including an already scrolled
    // page and the PDF's desk margins, instead of jumping toward its corner.
    const updated = this.s.canvas.getBoundingClientRect()
    this.s.container.scrollTo({
      left:this.s.container.scrollLeft + updated.left + focalX * (updated.width || parseFloat(this.s.canvas.style.width)) - x,
      top:this.s.container.scrollTop + updated.top + focalY * (updated.height || parseFloat(this.s.canvas.style.height)) - y,
      behavior:'instant'
    })
  }

  #renderPreferences() {
    const p = this.s.preferences
    return JSON.stringify([p.pdfMode, p.zoom, this.s.zoomed, p.theme,
      ...(p.pdfMode === 'text' ? [p.font, p.fontSize, p.lineHeight, p.fontWeight, p.margin, p.align] : [])])
  }

  #renderKey() {
    return { doc:this.s.doc, page:this.s.pageNum, geometry:this.#speechGeometry(), preferences:this.#renderPreferences() }
  }

  #sameRenderKey(a, b) {
    return Boolean(a && b && a.doc === b.doc && a.page === b.page && a.preferences === b.preferences
      && a.geometry.every((value, index) => value === b.geometry[index]))
  }

  #renderRootsMatch(state) {
    return state && state.canvas === this.s.canvas && state.textLayerEl === this.s.textLayerEl
      && state.pageWrap === this.s.pageWrap && state.reflow === this.s.reflow
      && state.pageWrap.parentNode === this.s.container && state.reflow.parentNode === this.s.container
      && state.canvas.parentNode === state.pageWrap && state.textLayerEl.parentNode === state.pageWrap
  }

  #rememberRenderedPage(state) {
    state.complete = true
    state.key ??= this.#renderKey()
    state.painted = {
      width:state.canvas.width, height:state.canvas.height,
      cssWidth:state.canvas.style.width, cssHeight:state.canvas.style.height,
      original:state.originalCanvas, originalWidth:state.originalCanvas?.width, originalHeight:state.originalCanvas?.height,
      text:state.textLayerEl.textContent, layerStyle:state.textLayerEl.style.cssText,
      nodes:[...state.textLayerEl.childNodes], reflowText:state.reflow.textContent, reflowStyle:state.reflow.style.cssText
    }
  }

  #renderIsIntact(state) {
    const saved = state?.painted
    if (!state?.complete || !saved || !this.#renderRootsMatch(state)) return false
    if (this.s.preferences.pdfMode === 'text') {
      return state.reflow.textContent === saved.reflowText && state.reflow.style.cssText === saved.reflowStyle
    }
    return state.layoutWidth === state.key.geometry[0] && state.canvas.width === saved.width && state.canvas.height === saved.height
      && state.canvas.style.width === saved.cssWidth && state.canvas.style.height === saved.cssHeight
      && state.originalCanvas === saved.original && state.originalCanvas?.width === saved.originalWidth
      && state.originalCanvas?.height === saved.originalHeight && state.textLayerEl.textContent === saved.text
      && state.textLayerEl.style.cssText === saved.layerStyle && state.textLayerEl.childNodes.length === saved.nodes.length
      && saved.nodes.every((node, index) => node === state.textLayerEl.childNodes[index])
  }

  #trackRender(promise, key) {
    const request = this.s.renderRequest = { key }
    this.s.renderReady = promise.finally(() => { if (this.s.renderRequest === request) this.s.renderRequest = null })
    return this.s.renderReady
  }

  #render() {
    const key = this.#renderKey(), state = this.s.renderState
    // A restore can arrive while the same page or its theme is still settling.
    // Await that work; only completed, unchanged pixels and text are reusable.
    if (this.#sameRenderKey(this.s.renderRequest?.key, key) && this.#renderRootsMatch(state)) return this.s.renderReady
    if (this.#sameRenderKey(state?.key, key) && this.#renderIsIntact(state)) return this.s.renderReady
    return this.#trackRender(this.#renderPage(key), key)
  }

  #containerWidth() {
    return this.s.container.clientWidth || this.s.container.getBoundingClientRect().width || 360
  }

  #onResize() {
    if (this.s.stagedSpeech && !this.s.stagedSpeech.valid()) this.#invalidateStagedSpeech()
    if (!this.s.doc) return
    if (this.s.preferences.pdfMode === 'text') {
      if (!this.#textLayoutChanged()) return
      const offset = this.s.textOffset, pdf = this.s.doc, page = this.s.pageNum
      clearTimeout(this.s.scrollTimer)
      this.s.layoutWidth = this.#containerWidth(); this.s.textHeight = this.s.container.clientHeight
      this.#cancelResize()
      this.s.resizeTimer = setTimeout(() => {
        this.s.resizeTimer = null
        if (this.s.doc !== pdf || this.s.pageNum !== page || this.s.preferences.pdfMode !== 'text') return
        this.#restoreTextOffset(offset)
      }, 80)
      return
    }
    if (Math.abs(this.#containerWidth() - this.s.layoutWidth) < 1) return
    clearTimeout(this.s.resizeTimer)
    this.s.resizeTimer = setTimeout(() => {
      this.s.resizeTimer = null
      if (!this.s.doc) return
      this.#render().catch(error => {
        if (this.s.doc) console.warn('No se pudo adaptar la página al nuevo tamaño.', error)
      })
    }, 80)
  }

  async #renderPage(key) {
    const token = ++this.s.renderToken
    this.s.container.setAttribute('aria-busy', 'true')
    this.#invalidateStagedSpeech()
    this.#cancelRender(this.s.renderState)
    this.#releaseOriginal(this.s.renderState)
    const state = this.s.renderState = {
      pageWrap:this.s.pageWrap, canvas:this.s.canvas, textLayerEl:this.s.textLayerEl, reflow:this.s.reflow, key
    }
    const page = await this.s.doc.getPage(this.s.pageNum)
    if (token !== this.s.renderToken) return false
    const rendered = await this.#drawPage(page, state, () => token === this.s.renderToken && Boolean(this.s.doc))
    if (!rendered) return false
    this.#useRenderedPage(state)
    return true
  }

  #cancelRender(state) { state?.renderTask?.cancel(); state?.textTask?.cancel() }

  #releaseOriginal(state) {
    if (state?.originalCanvas && state.originalCanvas !== state.canvas) {
      state.originalCanvas.width = state.originalCanvas.height = 0
    }
    if (state) state.originalCanvas = null
  }

  async #imageLayout(page) {
    if (!this.s.imageLayouts.has(page)) {
      this.s.imageLayouts.set(page, page.getOperatorList
        ? page.getOperatorList().then(list => !hasUntrackedPDFImages(list, pdfjsLib.OPS))
        : Promise.resolve(false))
    }
    return this.s.imageLayouts.get(page)
  }

  #useRenderedPage(state) {
    this.s.pageText = state.pageText
    this.s.baseScale = state.baseScale ?? this.s.baseScale
    this.s.layoutWidth = state.layoutWidth ?? this.s.layoutWidth
    this.s.container.dataset.readerZoomed = String(state.zoomed)
    this.s.container.setAttribute('aria-busy', 'false')
    this.#rememberRenderedPage(state)
  }

  // The same PDF.js rendering and mapping produce visible and staged pages. A staged
  // canvas/TextLayer stays detached until the engine reports its first audible sample.
  async #drawPage(page, state, valid, content) {
    const { pageWrap, canvas, textLayerEl, reflow } = state
    state.page = page
    const textMode = this.s.preferences.pdfMode === 'text'
    pageWrap.hidden = textMode
    reflow.hidden = !textMode
    if (textMode) {
      content ??= await page.getTextContent()
      if (!valid()) return false
      const viewport = page.getViewport({ scale:1 })
      state.textLayout = extractPDFText(content, viewport)
      state.pageText = state.textLayout.text
      // An EOL in a stream with unusable geometry is a physical line, not
      // evidence of a paragraph. The offsets remain verbatim for narration.
      reflow.style.whiteSpace = state.textLayout.geometric ? 'pre-wrap' : 'normal'
      const operators = await page.getOperatorList?.()
      if (!valid()) return false
      const imageOps = new Set(['paintImageXObject','paintInlineImageXObject','paintImageXObjectRepeat',
        'paintInlineImageXObjectGroup','paintImageMaskXObject','paintImageMaskXObjectRepeat',
        'paintImageMaskXObjectGroup','paintSolidColorImageMask'].map(name=>pdfjsLib.OPS?.[name]).filter(Number.isFinite))
      const hasImages = operators?.fnArray?.some(op=>imageOps.has(op))
      if (hasImages || !state.pageText.trim()) {
        const source = document.createElement('canvas')
        // Bound the temporary page buffer, keeping original composite pixels
        // at mobile DPR without retaining another full page after cropping.
        const width = Math.min(1600,Math.max(1,this.#containerWidth())*Math.min(2,window.devicePixelRatio || 1))
        const scale = Math.min(width/viewport.width,Math.sqrt(4_000_000/(viewport.width*viewport.height)))
        const renderedViewport = page.getViewport({scale})
        source.width = Math.max(1,Math.ceil(renderedViewport.width));source.height = Math.max(1,Math.ceil(renderedViewport.height))
        try {
          state.renderTask = page.render({canvasContext:source.getContext('2d'),viewport:renderedViewport,recordImages:true})
          await state.renderTask.promise
          if (!valid()) return false
          let rects = pdfImageRects(page.imageCoordinates || [],source.width,source.height)
          if (!state.pageText.trim() || hasUntrackedPDFImages(operators,pdfjsLib.OPS) || !rects.length)
            rects = [{x0:0,y0:0,x1:source.width,y1:source.height}]
          if (!await preparePDFReflow(reflow,state.textLayout,source,rects,viewport,valid)) return false
        } catch(error) {
          if (!valid() || error.name === 'RenderingCancelledException') return false
          throw error
        } finally { source.width = source.height = 0 }
      } else if (!await preparePDFReflow(reflow,state.textLayout,undefined,[],undefined,valid)) return false
      state.zoomed = false
      state.layoutWidth = this.#containerWidth()
      this.s.textHeight = this.s.container.clientHeight
      return true
    }

    const containerWidth = this.#containerWidth()
    const unscaledViewport = page.getViewport({ scale: 1 })
    // Fit the entire original page width. A minimum scale of .6 overflowed
    // ordinary A4 PDFs on narrow phones and made text/selection disagree.
    state.baseScale = containerWidth / unscaledViewport.width
    state.layoutWidth = containerWidth
    const scale = state.baseScale * (this.s.zoomed ? ZOOM_STEP_SCALE : this.s.preferences.zoom / 100)
    state.zoomed = this.s.zoomed || this.s.preferences.zoom > 100

    const dpr = window.devicePixelRatio || 1
    const viewport = page.getViewport({ scale: scale * dpr })

    canvas.width = viewport.width
    canvas.height = viewport.height
    canvas.style.width = `${viewport.width / dpr}px`
    canvas.style.height = `${viewport.height / dpr}px`

    const themeFilter = PDF_PAGE_FILTERS[this.s.preferences.theme]
    const original = state.originalCanvas = themeFilter === 'none' ? canvas : document.createElement('canvas')
    original.width = canvas.width; original.height = canvas.height
    original.style.width = canvas.style.width; original.style.height = canvas.style.height
    const ctx = original.getContext('2d')
    state.renderTask = page.render({ canvasContext: ctx, viewport, recordImages:true })
    try { await state.renderTask.promise } catch (error) {
      if (error.name === 'RenderingCancelledException') return false
      throw error
    }
    if (!valid()) return false
    if (original !== canvas && !await this.#paintTheme(state, this.s.preferences.theme, valid)) return false

    // Capa de texto seleccionable, alineada 1:1 con el canvas ya renderizado.
    textLayerEl.replaceChildren()
    textLayerEl.style.width = `${viewport.width / dpr}px`
    textLayerEl.style.height = `${viewport.height / dpr}px`
    const cssViewport = page.getViewport({ scale })
    const textContent = content ?? await page.getTextContent()
    if (!valid()) return false
    state.textLayout = extractPDFText(textContent, unscaledViewport)
    state.pageText = state.textLayout.text
    const textLayer = new TextLayer({
      textContentSource: state.textLayout.geometric ? { ...textContent, items:state.textLayout.items } : textContent,
      container: textLayerEl,
      viewport: cssViewport
    })
    state.textTask = textLayer
    // TextLayer sizes the container and every span through CSS variables (--total-scale-factor, --font-height, --scale-x,
    // --rotate; see .pdf-text-layer in app.css). Without the scale the spans were as wide as the fallback font made them,
    // not as wide as the glyphs on the canvas: selections and the read-aloud highlight were bars wider than the text.
    textLayerEl.style.setProperty('--total-scale-factor', String(scale))
    textLayerEl.style.width = `${viewport.width / dpr}px`
    textLayerEl.style.height = `${viewport.height / dpr}px`
    try { await textLayer.render() } catch (error) { if (!valid()) return false; throw error }
    if (!valid()) return false
    clearPDFReflow(reflow)
    return true
  }

  async #paintTheme(state, theme, valid) {
    const filter = PDF_PAGE_FILTERS[theme], { canvas, page } = state
    if (state.originalCanvas === canvas && filter === 'none') return valid()
    const tracked = filter === 'none' || await this.#imageLayout(page)
    if (!valid()) return false
    if (state.originalCanvas === canvas) {
      const original = document.createElement('canvas')
      original.width = canvas.width; original.height = canvas.height
      original.getContext('2d').drawImage(canvas, 0, 0)
      state.originalCanvas = original
    }
    paintPDFTheme(state.originalCanvas, canvas, tracked && page.imageCoordinates != null ? filter : 'none', page.imageCoordinates || [])
    return valid()
  }

  // A theme switch reuses decoded PDF pixels and the selectable text layer.
  // The canvas is repainted synchronously only when everything is ready, so
  // changing the paper colour never clears the visible page for a new render.
  async #retheme(ready, preferences) {
    await ready
    const state = this.s.renderState
    const valid = () => Boolean(this.s.doc) && state === this.s.renderState
      && preferences.theme === this.s.preferences.theme && preferences.pdfMode === this.s.preferences.pdfMode
      && preferences.zoom === this.s.preferences.zoom
    if (!valid() || !state?.originalCanvas) return false
    const painted = await this.#paintTheme(state, preferences.theme, valid)
    if (painted) {
      state.key = { ...state.key, preferences:this.#renderPreferences() }
      this.#rememberRenderedPage(state)
      this.s.container.setAttribute('aria-busy', 'false')
    }
    return painted
  }

  async getSpeechText() {
    if (!this.s.doc) return ''
    const page = await this.s.doc.getPage(this.s.pageNum)
    const text = await page.getTextContent()
    return extractPDFText(text, page.getViewport({ scale:1 })).text
  }
  #speechMap() {
    return this.s.preferences.pdfMode === 'text'
      ? mapTextNodes(this.s.reflow)
      : mapPDFTextLayer(this.s.textLayerEl, this.s.renderState?.textLayout) || mapTextLayer(this.s.textLayerEl)
  }

  /** The page's text as the audiobook reads it, mapped onto the rendered text layer (or the reflow text) it is highlighted in. */
  async getSpeechSource({ completeSentences = false } = {}) {
    if (!this.s.doc) return null
    let pending
    do { pending = this.s.renderReady; await pending } while (this.s.doc && pending !== this.s.renderReady)
    if (!this.s.doc) return null
    const pdf = this.s.doc, pageNumber = this.s.pageNum
    const source = this.#makeSpeechSource(pageNumber, this.#speechMap(), this.s.renderState?.textLayout).source
    if (completeSentences) {
      source.start = this.s.preferences.pdfMode === 'text' ? this.#visibleTextOffset() : 0
      if (pageNumber > 1 && source.start === 0) {
        const previous = await pdf.getPage(pageNumber - 1)
        const content = await previous.getTextContent()
        if (pdf !== this.s.doc || pageNumber !== this.s.pageNum) throw speechCancelled()
        source.previousText = extractPDFText(content, previous.getViewport({scale:1})).text
      }
    }
    return source
  }

  #makeSpeechSource(page, first, textLayout) {
    const pdf = this.s.doc
    const doc = this.s.container.ownerDocument
    installSpeechStyle(doc, this.s.preferences.theme)
    let map = first, marked = []
    const mappedToVisiblePage = () => {
      const node = map.spans[0]?.node
      const root = this.s.preferences.pdfMode === 'text' ? this.s.reflow : this.s.textLayerEl
      return Boolean(node?.isConnected && root.contains(node))
    }
    // A zoom or view change re-renders the layer under a paused voice: re-map it, but only if it is still this page's text.
    const current = () => {
      if (this.s.doc === pdf && page === this.s.pageNum && !mappedToVisiblePage()) {
        const again = this.#speechMap()
        // TextLayer omits the final item's separator; reflow retains it. Only this
        // trailing whitespace may differ: every spoken character keeps its raw offset.
        if (again.text.trimEnd() === first.text.trimEnd()) map = again
      }
      return this.s.doc === pdf && page === this.s.pageNum && mappedToVisiblePage() ? map : null
    }
    const clear = () => {
      clearSpeechRange(doc)
      for (const element of marked) element.classList.remove(SPEECH_SPAN_CLASS)
      marked = []
    }
    const source = {
      text:first.text, start:0, clear, physicalPage:page,
      offsetAtPoint:(tapped, x, y) => {
        if (tapped !== doc) return NaN
        const caret = doc.caretPositionFromPoint?.(x,y)
        const range = caret ? null : doc.caretRangeFromPoint?.(x,y)
        const node = caret?.offsetNode || range?.startContainer
        const live = current()
        return node && live?.spans.some(span => span.node === node) ? live.offsetOf(node, caret?.offset ?? range.startOffset) : NaN
      },
      // Geometric paragraphs are real body text, including repeated dialogue.
      // No marginal header is confirmed by page-local layout alone: preserve
      // those paragraphs even when the legacy header-skipping option is on.
      ...(textLayout?.geometric || this.s.preferences.pdfMode === 'text' ? { headerRanges:Object.freeze([]) } : {}),
      highlight:(start, end) => {
        if (this.s.speechBrowsing) return
        const live = current(), range = live?.rangeFor(start, end)
        clear()
        if (!range) return
        if (paintSpeechRange(range)) return
        // Fallback for WebViews without the Highlight API: tint the text-layer spans (or reflow page) the sentence touches.
        marked = live.spans.filter(span => span.end > start && span.start < end).map(span => span.node.parentElement)
        for (const element of marked) element.classList.add(SPEECH_SPAN_CLASS)
      },
      follow:(start, end) => {
        this.s.speechCursor = { page, start, end, source }
        if (this.s.speechBrowsing) return
        if (page !== this.s.pageNum) { void this.#revealSpeech().catch(() => {}); return }
        this.#settleTextResize()
        const rects = current()?.rangeFor(start, end)?.getClientRects()
        const box = this.s.container.getBoundingClientRect()
        const offset = speechFollowOffset(rects,box)
        if (!offset) return
        this.s.container.scrollBy({
          ...offset,
          behavior:window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'
        })
      }
    }
    return { source, current }
  }

  browseSpeech() { this.s.speechBrowsing = true; this.s.speechDetached = true }
  stopSpeech() { this.s.speechBrowsing = false; this.s.speechDetached = false; this.s.speechCursor = null; this.#invalidateStagedSpeech() }
  async returnToSpeech() {
    this.s.speechBrowsing = false
    await this.#revealSpeech()
  }
  #revealSpeech() {
    if (this.s.speechReveal) return this.s.speechReveal
    const pdf = this.s.doc
    const work = async () => {
      while (!this.s.speechBrowsing && pdf === this.s.doc && this.s.speechCursor) {
        const target = this.s.speechCursor
        if (target.page !== this.s.pageNum) await this.goToPage(target.page, { textOffset:target.start })
        if (pdf !== this.s.doc || this.s.speechBrowsing) return
        if (target !== this.s.speechCursor && target.page !== this.s.speechCursor?.page) continue
        const current = this.s.speechCursor
        current?.source.highlight?.(current.start,current.end)
        current?.source.follow?.(current.start,current.end)
        return
      }
    }
    const task = work().finally(() => { if (this.s.speechReveal === task) this.s.speechReveal = null })
    this.s.speechReveal = task
    return task
  }

  async #nextDetachedSpeech({ isActive, afterPage }) {
    const pdf = this.s.doc, previous = afterPage ?? this.s.speechCursor?.page ?? this.s.pageNum
    for (let number = previous + 1; number <= Math.min(pdf.numPages, previous + MAX_EMPTY_SPEECH_PAGES); number++) {
      const page = await pdf.getPage(number)
      const content = await page.getTextContent()
      if (this.s.doc !== pdf || !isActive()) throw speechCancelled()
      const layout = extractPDFText(content, page.getViewport({scale:1}))
      if (!layout.text.trim()) continue
      const { source } = this.#makeSpeechSource(number, { text:layout.text, spans:[] }, layout)
      source.isValid = () => this.s.doc === pdf && isActive()
      source.activate = () => source.isValid()
      return source
    }
    return null
  }

  #speechGeometry() {
    const rect = this.s.container.getBoundingClientRect()
    return [this.#containerWidth(), this.s.container.clientHeight || rect.height, window.devicePixelRatio || 1]
  }

  #invalidateStagedSpeech() {
    const staged = this.s.stagedSpeech
    if (!staged) return
    this.s.stagedSpeech = null
    staged.invalid = true
    this.#cancelRender(staged)
    this.#releaseOriginal(staged)
    staged.canvas.width = staged.canvas.height = 0
    staged.pageWrap.replaceChildren()
    clearPDFReflow(staged.reflow)
  }

  /**
   * Draw the next readable PDF page without relocating or replacing the visible page.
   * Only activate(), called on the engine's audible start, commits its pixels and exact
   * text mapping. This avoids showing the next page throughout neural synthesis.
   */
  async getNextSpeechSource({ isActive = () => true, afterPage } = {}) {
    if (this.s.doc && (this.s.speechDetached || Number.isInteger(afterPage) && afterPage !== this.s.pageNum))
      return this.#nextDetachedSpeech({ isActive, afterPage })
    this.#invalidateStagedSpeech()
    if (!this.s.doc || !isActive()) throw speechCancelled()
    const pdf = this.s.doc, previousPage = this.s.pageNum, token = this.s.renderToken, preferences = this.s.preferences
    const request = ++this.s.speechRequest, geometry = this.#speechGeometry(), pending = this.s.renderReady
    const unchanged = () => this.s.doc === pdf && this.s.pageNum === previousPage && this.s.renderToken === token
      && this.s.preferences === preferences && request === this.s.speechRequest && isActive()
      && geometry.every((value, index) => value === this.#speechGeometry()[index])
    await pending
    if (!unchanged() || pending !== this.s.renderReady) throw speechCancelled()
    if (previousPage === pdf.numPages) return null
    const staged = {
      pageWrap:this.s.pageWrap.cloneNode(false), canvas:this.s.canvas.cloneNode(false),
      textLayerEl:this.s.textLayerEl.cloneNode(false), reflow:this.s.reflow.cloneNode(false), invalid:false
    }
    staged.reflow.classList.remove(SPEECH_SPAN_CLASS)
    staged.pageWrap.append(staged.canvas, staged.textLayerEl)
    staged.valid = () => !staged.invalid && this.s.stagedSpeech === staged && unchanged()
    this.s.stagedSpeech = staged
    try {
      for (let number = previousPage + 1; number <= pdf.numPages && number <= previousPage + MAX_EMPTY_SPEECH_PAGES; number++) {
        const page = await pdf.getPage(number)
        if (!staged.valid()) throw speechCancelled()
        const content = await page.getTextContent()
        if (!staged.valid()) throw speechCancelled()
        if (!content.items.some(item => typeof item.str === 'string' && item.str.trim())) {
          if (number === pdf.numPages) { this.#invalidateStagedSpeech(); return null }
          continue
        }
        if (!await this.#drawPage(page, staged, staged.valid, content)) throw speechCancelled()
        const first = preferences.pdfMode === 'text'
          ? mapTextNodes(staged.reflow)
          : mapPDFTextLayer(staged.textLayerEl, staged.textLayout) || mapTextLayer(staged.textLayerEl)
        if (!first.text.trim()) throw new Error('No se pudo preparar el texto de la página siguiente.')
        const { source, current } = this.#makeSpeechSource(number, first, staged.textLayout)
        const clear = source.clear
        let activated = false
        source.isValid = () => this.s.doc === pdf && (this.s.speechDetached ? isActive() : activated ? Boolean(current()) : staged.valid())
        source.activate = () => {
          if (activated) return source.isValid()
          if (this.s.speechDetached && this.s.doc === pdf && isActive()) { activated = true; return true }
          if (!staged.valid()) { source.clear(); return false }
          this.s.stagedSpeech = null
          this.#cancelRender(this.s.renderState)
          this.#releaseOriginal(this.s.renderState)
          clearPDFReflow(this.s.reflow)
          ++this.s.renderToken
          const oldCanvas = this.s.canvas
          this.s.pageWrap.replaceWith(staged.pageWrap)
          this.s.reflow.replaceWith(staged.reflow)
          this.s.pageWrap = staged.pageWrap; this.s.canvas = staged.canvas
          this.s.textLayerEl = staged.textLayerEl; this.s.reflow = staged.reflow
          this.s.renderState = staged
          this.#cancelResize()
          this.s.renderRequest = null
          this.s.renderReady = Promise.resolve(true)
          this.s.pageNum = number
          this.#useRenderedPage(staged)
          clearTimeout(this.s.scrollTimer)
          this.s.container.scrollTop = 0
          this.s.textOffset = 0
          oldCanvas.width = oldCanvas.height = 0
          activated = true
          this.#emitLocation()
          return true
        }
        source.clear = () => {
          if (activated) clear()
          else {
            if (this.s.stagedSpeech === staged) this.#invalidateStagedSpeech()
            else staged.invalid = true
          }
        }
        return source
      }
      throw new Error('Página siguiente sin texto legible.')
    } catch (error) {
      const cancelled = !staged.valid()
      if (this.s.stagedSpeech === staged) this.#invalidateStagedSpeech()
      throw cancelled ? speechCancelled() : error
    }
  }

  /** The restored reading page, copied only after its latest render settles. */
  async getPageSnapshot({ reuseSettledLayout = false } = {}) {
    if (!this.s.doc) return null
    let pending
    do {
      pending = this.s.renderReady
      await pending
    } while (this.s.doc && pending !== this.s.renderReady)
    if (!this.s.doc) return null
    const textMode = this.s.preferences.pdfMode === 'text'
    // An explicit snapshot can arrive before ResizeObserver's delayed render.
    // Finish that exact render first, preserving the page, text and resolution.
    if (reuseSettledLayout && !textMode && (!this.#sameRenderKey(this.s.renderState?.key, this.#renderKey())
        || !this.#renderIsIntact(this.s.renderState))) {
      this.#cancelResize()
      await this.#render()
      return this.getPageSnapshot({ reuseSettledLayout })
    }
    // Completed physical pixels need no additional paints when their layout
    // and text are intact. DOM text still waits for fonts and both frames.
    const settledPhysical = reuseSettledLayout && !textMode && this.s.resizeTimer == null
      && this.#sameRenderKey(this.s.renderState?.key, this.#renderKey()) && this.#renderIsIntact(this.s.renderState)
    if (!settledPhysical) await settlePageLayout(this.s.container.ownerDocument, { waitForFonts:textMode })
    if (!this.s.doc || pending !== this.s.renderReady
      || textMode !== (this.s.preferences.pdfMode === 'text')) return this.getPageSnapshot({ reuseSettledLayout })
    const page = this.s.pageNum
    if (textMode) { this.#settleTextResize(); this.#rememberTextPosition() }
    // Physical white pages blend into the current reader theme on opening.
    const theme = READING_THEMES[this.s.preferences.theme]
    const canvasFilter = textMode ? null : renderedPageFilter(this.s.canvas)
    const snapshot = textMode
      ? await snapshotDOMPage(this.s.reflow, {
        paper:{ background:'#ffffff', color:'#292821', themeColor:theme.color },
        viewport:this.s.container.getBoundingClientRect(),
        offsetX:this.s.container.getBoundingClientRect().left,
        offsetY:this.s.container.getBoundingClientRect().top,
        background:getComputedStyle(this.s.reflow).backgroundColor,
        filter:renderedPageFilter(this.s.reflow)
      })
      : snapshotCanvas(this.s.canvas, {
        filter:canvasFilter, displayBounds:this.s.canvas.getBoundingClientRect(),
        paper:true, paperSource:this.s.renderState?.originalCanvas || this.s.canvas
      })
    if (!snapshot || !this.s.doc || page !== this.s.pageNum) return null
    if (!textMode) {
      // Each snapshot still owns fresh copies of the exact page pixels. Reuse
      // only its margin-colour measurement while the settled raster, source
      // dimensions and applied filter remain identical. Navigation, rendering,
      // zoom, theme or brightness changes invalidate both opaque tokens.
      const original = this.s.renderState?.originalCanvas || this.s.canvas
      const facts = [this.s.doc, pending, this.s.renderToken, this.s.canvas,
        this.s.canvas.width, this.s.canvas.height, original, original.width,
        original.height, canvasFilter]
      if (!this.s.snapshotToneState || facts.some((value, i) => value !== this.s.snapshotToneState.facts[i])) {
        this.s.snapshotToneState?.controller.abort()
        this.s.snapshotToneState = { facts, theme:Object.freeze({}), paper:Object.freeze({}), themeRaster:Object.freeze({}), paperRaster:Object.freeze({}), controller:new AbortController() }
      }
      snapshot.toneKey = this.s.snapshotToneState.theme
      if (snapshot.paper) snapshot.paper.toneKey = this.s.snapshotToneState.paper
      const state = this.s.snapshotToneState
      // Both copies use the exact same source, filter and resampling when the
      // physical page is already unfiltered white paper. Share only that proven
      // raster's tone and texture revision; changed themes retain separate maps.
      const samePaper = original === this.s.canvas && canvasFilter === 'none'
      if (samePaper && snapshot.paper) sharePaperTone(state.paper, state.theme)
      await prepareSnapshotPaperTones(snapshot, { signal:state.controller.signal })
      if (!this.s.doc) return null
      if (state !== this.s.snapshotToneState || pending !== this.s.renderReady || page !== this.s.pageNum
        || facts[2] !== this.s.renderToken || this.s.preferences.pdfMode === 'text'
        || facts[4] !== this.s.canvas.width || facts[5] !== this.s.canvas.height
        || facts[7] !== original.width || facts[8] !== original.height
        || canvasFilter !== renderedPageFilter(this.s.canvas)
        || settledPhysical && !this.#sameRenderKey(this.s.renderState?.key, this.#renderKey())) return this.getPageSnapshot({ reuseSettledLayout })
      registerPageRaster(snapshot.source, state.themeRaster)
      if (snapshot.paper) registerPageRaster(snapshot.paper.source, samePaper ? state.themeRaster : state.paperRaster)
    } else {
      this.s.snapshotToneState?.controller.abort()
      this.s.snapshotToneState = undefined
    }
    return { ...snapshot, engine:'pdf', sourceType:textMode ? 'pdf-text' : 'pdf-canvas',
      text:snapshot.text || this.s.pageText, label:`Página ${page} de ${this.pageCount}`,
      location:{ fraction:(page - 1) / Math.max(1, this.pageCount - 1), locator:{ kind:'pdf-page', value:page,
        ...(this.s.textOffset > 0 ? { textOffset:this.s.textOffset } : {}) } } }
  }
  async search(query) {
    const term = String(query || '').trim().toLocaleLowerCase()
    if (!term || !this.s.doc) return []
    const results = []
    for (let pageNumber = 1; pageNumber <= this.pageCount; pageNumber++) {
      const page = await this.s.doc.getPage(pageNumber)
      const content = await page.getTextContent()
      const text = extractPDFText(content, page.getViewport({ scale:1 })).text.replace(/\s+/g,' ').trim()
      const haystack = text.toLocaleLowerCase()
      let at = 0
      while ((at = haystack.indexOf(term,at)) >= 0 && results.length < 500) {
        // Context cut at word boundaries, so an excerpt never starts mid-word.
        const stop = at + term.length
        let start = Math.max(0,at-60), end = Math.min(text.length,stop+80)
        if (start > 0) { const space = text.indexOf(' ',start); start = space >= 0 && space < at ? space + 1 : at }
        if (end < text.length) { const space = text.lastIndexOf(' ',end); end = space > stop ? space : stop }
        const parts = { pre:`${start > 0 ? '…' : ''}${text.slice(start,at)}`, match:text.slice(at,stop), post:`${text.slice(stop,end)}${end < text.length ? '…' : ''}` }
        results.push({label:`Página ${pageNumber}`,parts,excerpt:`${parts.pre}${parts.match}${parts.post}`,locator:{kind:'pdf-page',value:pageNumber},fraction:(pageNumber-1)/Math.max(1,this.pageCount-1)})
        at += Math.max(1,term.length)
      }
      if (results.length >= 500) break
    }
    return results
  }
  getSelection() { return window.getSelection()?.toString()?.trim() || '' }
  async applyPreferences(preferences) {
    this.#invalidateStagedSpeech()
    const previous = this.s.preferences
    this.#settleTextResize()
    this.#cancelResize()
    const offset = previous.pdfMode === 'text' ? this.#visibleTextOffset() : this.s.textOffset
    if (this.s.doc && previous.pdfMode === 'text' && offset !== this.s.textOffset) {
      this.s.textOffset = offset
      this.#emitLocation()
    }
    this.s.preferences = normalizeReadingPreferences(preferences)
    const p = this.s.preferences
    this.#applyTextStyles()
    if (this.s.doc && (previous.pdfMode !== p.pdfMode || previous.zoom !== p.zoom)) await this.#render()
    else if (this.s.doc && p.pdfMode !== 'text' && previous.theme !== p.theme) {
      this.s.container.setAttribute('aria-busy', 'true')
      const ready = this.s.renderReady
      await this.#trackRender(this.#retheme(ready, p), this.#renderKey())
    }
    this.s.textOffset = offset
    if (this.s.doc && p.pdfMode === 'text') {
      clearTimeout(this.s.scrollTimer)
      this.#restoreTextOffset(offset)
    }
  }

  #applyTextStyles() {
    const p = this.s.preferences
    Object.assign(this.s.reflow.style, {
      fontFamily:READING_FONTS[p.font], fontSize:`${p.fontSize}px`, lineHeight:String(p.lineHeight),
      fontWeight:String(p.fontWeight), padding:`12px ${p.margin}px`, textAlign:p.align
    })
  }

  /** Miniatura de la página 1 como Blob, para la portada de la estantería. */
  async getCoverBlob({ signal, retainOnClose = false } = {}) {
    const doc = this.s.doc
    const loading = this.s.loadingTask
    if (!doc || signal?.aborted) return null
    // A first cover belongs to this captured document, even if its reader UI
    // closes. Other optional HD jobs keep their original cancellation policy.
    let retained
    if (retainOnClose && loading) {
      retained = this.s.retainedCovers.get(loading)
      if (!retained) this.s.retainedCovers.set(loading, retained = { count:0, closing:false })
      retained.count++
    }
    const current = () => !signal?.aborted && (this.s.doc === doc || retained?.closing === true)
    let renderTask
    const cancel = () => { renderTask?.cancel?.() }
    try {
      const page = await doc.getPage(1)
      if (!current()) return null
      const viewport = page.getViewport({ scale: 1 })
      // La portada se ve a casi tamaño real durante la apertura. 300 px daba
      // miniaturas blandas en pantallas móviles; renderizamos hasta 1200 px,
      // con un límite de 1600 px por el lado mayor y sin ampliar el PDF más de 3×.
      const scale = Math.min(3, 1600 / Math.max(viewport.width, viewport.height), 1200 / viewport.width)
      const thumbViewport = page.getViewport({ scale })

      const canvas = document.createElement('canvas')
      canvas.width = thumbViewport.width
      canvas.height = thumbViewport.height
      signal?.addEventListener('abort', cancel, { once:true })
      if (!current()) return null
      renderTask = page.render({ canvasContext: canvas.getContext('2d'), viewport: thumbViewport })
      if (!current()) cancel()
      await renderTask.promise
      renderTask = null
      if (!current()) return null
      // The worker keeps this exact raster and JPEG quality, while its GPU
      // readback/encoding leaves the UI thread free for the book animation.
      const blob = await encodePdfCover(canvas, { signal })
      return current() ? blob : null
    } catch (error) {
      if (!current()) return null
      throw error
    } finally {
      signal?.removeEventListener('abort', cancel)
      if (retained && --retained.count === 0) {
        this.s.retainedCovers.delete(loading)
        if (retained.closing) {
          try { await loading.destroy() }
          catch (error) { console.warn('No se pudo liberar el PDF de la portada:', error) }
        }
      }
    }
  }

  close() {
    this.s.resizeObserver?.disconnect()
    this.s.resizeObserver = null
    clearTimeout(this.s.resizeTimer)
    this.s.resizeTimer = null
    clearTimeout(this.s.scrollTimer)
    this.s.scrollTimer = null
    this.s.detachScroll()
    this.s.detachScroll = () => {}
    this.s.textOffset = 0
    this.s.textHeight = 0
    this.s.lengthMetadata = null
    this.s.layoutWidth = 0
    ++this.s.renderToken
    this.#invalidateStagedSpeech()
    this.#cancelRender(this.s.renderState)
    this.#releaseOriginal(this.s.renderState)
    if (this.s.reflow) clearPDFReflow(this.s.reflow)
    this.s.renderState = null
    this.s.renderRequest = null
    this.s.detachGestures()
    // PDFDocumentProxy no expone destroy(): la limpieza vive en el
    // loadingTask (ver pdfjs-dist/build/pdf.mjs, PDFDocumentLoadingTask).
    const loading = this.s.loadingTask, retained = this.s.retainedCovers.get(loading)
    if (retained) retained.closing = true
    else loading?.destroy()
    this.s.loadingTask = null
    this.s.doc = null
    this.s.imageLayouts = new WeakMap()
    this.s.snapshotToneState?.controller.abort()
    this.s.snapshotToneState = undefined
    this.s.pageText = ''
    if (this.s.container) {
      this.s.container.innerHTML = ''
      this.s.container.classList.remove('pdf-reader')
      this.s.container.removeAttribute('aria-busy')
      delete this.s.container.dataset.readerZoomed
    }
  }
}
