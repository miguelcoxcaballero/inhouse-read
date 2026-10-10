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
import { clearPDFReflow, pdfImageRects, preparePDFReflow } from './pdf-reflow.js'
import { extractPDFText, mapPDFTextLayer } from './pdf-text.js'
import { SPEECH_SPAN_CLASS, clearSpeechRange, installSpeechStyle, paintSpeechRange } from './speech-highlight.js'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

const ZOOM_STEP_SCALE = 2.2
const MAX_EMPTY_SPEECH_PAGES = 12
const speechCancelled = () => new DOMException('La preparación de la página ha cambiado.', 'AbortError')

export class PdfReader {
  #container
  #loadingTask
  #doc
  #retainedCovers = new Map()
  #pageNum = 1
  #baseScale = 1
  #zoomed = false
  #canvas
  #textLayerEl
  #pageWrap
  #renderToken = 0
  #onRelocate = () => {}
  #detachGestures = () => {}
  #preferences = { ...DEFAULT_READING_PREFERENCES }
  #reflow
  #renderState
  #stagedSpeech
  #speechRequest = 0
  #renderReady = Promise.resolve()
  #renderRequest
  #pageText = ''
  #resizeObserver
  #resizeTimer
  #layoutWidth = 0
  #imageLayouts = new WeakMap()
  #snapshotToneState
  #lengthMetadata
  #textOffset = 0
  #textHeight = 0
  #scrollTimer
  #detachScroll = () => {}

  async open(container, arrayBuffer, { onRelocate, onToggleChrome, onUserNavigation, initialPage, initialLocator, initialFraction = 0, preferences } = {}) {
    this.#container = container
    this.#onRelocate = onRelocate ?? (() => {})

    const loading = this.#loadingTask = pdfjsLib.getDocument({ data: arrayBuffer })
    const pdf = await loading.promise
    if (loading !== this.#loadingTask) return
    this.#doc = pdf
    this.#lengthMetadata = null
    this.#textOffset = 0
    this.#zoomed = false
    if (preferences) this.#preferences = normalizeReadingPreferences(preferences)

    container.innerHTML = ''
    container.classList.add('pdf-reader')
    container.classList.remove('foliate-reader')

    this.#pageWrap = document.createElement('div')
    this.#pageWrap.className = 'pdf-page-wrap'
    this.#canvas = document.createElement('canvas')
    this.#canvas.className = 'pdf-page-canvas'
    this.#textLayerEl = document.createElement('div')
    this.#textLayerEl.className = 'pdf-text-layer'

    this.#pageWrap.append(this.#canvas, this.#textLayerEl)
    container.append(this.#pageWrap)
    this.#reflow = document.createElement('article')
    this.#reflow.className = 'pdf-reflow-page'
    this.#reflow.hidden = true
    container.append(this.#reflow)
    this.#applyTextStyles()
    const onScroll = () => {
      if (!this.#doc || this.#preferences.pdfMode !== 'text') return
      clearTimeout(this.#scrollTimer)
      this.#scrollTimer = setTimeout(() => this.#rememberTextPosition(), 150)
    }
    container.addEventListener('scroll', onScroll, { passive:true })
    this.#detachScroll = () => container.removeEventListener('scroll', onScroll)

    this.#detachGestures = attachSwipeNavigation(container, {
      onNext: () => { onUserNavigation?.(); return this.next() },
      onPrev: () => { onUserNavigation?.(); return this.prev() },
      onToggleZoom: (x, y) => this.toggleZoom(x, y),
      onToggleChrome,
      // Enlarged PDFs must pan, rather than accidentally turn a page. Let the
      // browser supply its touch momentum and keep long-press selection native.
      canSwipe: () => this.#preferences.pdfMode === 'text'
        || !this.#zoomed && this.#preferences.zoom <= 100,
      getMotionSurface: () => this.#preferences.pdfMode === 'text' ? this.#reflow : this.#pageWrap
    })

    await this.goToPage(initialPage ?? (initialLocator?.kind === 'pdf-page' ? initialLocator.value : undefined)
      ?? Math.round((Number(initialFraction) || 0) * (pdf.numPages - 1)) + 1, { textOffset:initialLocator?.textOffset })
    if (loading !== this.#loadingTask) return
    // The reader lives inside the actual usable viewport. A phone rotation,
    // split view or browser resize must refit both pixels and selection, without
    // treating that layout change as navigation or losing the saved page.
    if (typeof ResizeObserver !== 'undefined') {
      this.#resizeObserver = new ResizeObserver(() => this.#onResize())
      this.#resizeObserver.observe(container)
    }
  }

  get pageCount() {
    return this.#doc?.numPages ?? 0
  }

  get currentPage() {
    return this.#pageNum
  }

  async goToPage(n, { textOffset = 0, edge } = {}) {
    if (!this.#doc) return
    this.#cancelResize()
    this.#invalidateStagedSpeech()
    const clamped = Math.min(Math.max(1, Math.round(Number(n) || 1)), this.#doc.numPages)
    this.#pageNum = clamped
    const rendered = await this.#render()
    if (!rendered || this.#pageNum !== clamped) return
    this.#cancelResize()
    clearTimeout(this.#scrollTimer)
    this.#container.scrollTop = edge === 'end' && this.#preferences.pdfMode === 'text'
      ? Math.max(0, this.#container.scrollHeight - this.#container.clientHeight) : 0
    this.#textOffset = Math.min(this.#pageText.length, Number.isFinite(Number(textOffset)) ? Math.max(0, Math.trunc(Number(textOffset))) : 0)
    if (edge === 'end') this.#textOffset = this.#visibleTextOffset()
    else this.#restoreTextOffset(this.#textOffset)
    this.#emitLocation()
  }

  async next({ source = false, isActive } = {}) {
    if (!this.#doc || isActive?.() === false) return
    // The voice has already read the entire physical page. Manual navigation
    // instead traverses every screen of an adaptable page before leaving it.
    if (!source && this.#moveTextViewport(1)) return
    if (this.#pageNum < this.pageCount) await this.goToPage(this.#pageNum + 1)
  }

  async prev() {
    if (!this.#doc || this.#moveTextViewport(-1)) return
    if (this.#pageNum > 1) await this.goToPage(this.#pageNum - 1, { edge:'end' })
  }

  #moveTextViewport(direction) {
    if (this.#preferences.pdfMode !== 'text') return false
    this.#settleTextResize()
    const height = this.#container.clientHeight
    if (!(height > 0)) return false
    const end = Math.max(0, this.#container.scrollHeight - height)
    const current = Math.min(end, Math.max(0, this.#container.scrollTop))
    if (direction > 0 ? current >= end - 1 : current <= 1) return false
    // One line of overlap makes words on a viewport boundary readable in full.
    const line = Math.ceil(this.#preferences.fontSize * this.#preferences.lineHeight)
    const top = Math.min(end, Math.max(0, current + direction * Math.max(1, height - line)))
    this.#container.scrollTo({ top, behavior:'instant' })
    this.#rememberTextPosition()
    return true
  }

  #visibleTextOffset() {
    const map = mapTextNodes(this.#reflow), doc = this.#reflow?.ownerDocument
    if (this.#preferences.pdfMode !== 'text' || !map.text || !doc?.createRange) return this.#textOffset
    const edge = this.#container.getBoundingClientRect().top
    const range = doc.createRange()
    if (typeof range.getClientRects !== 'function') return this.#textOffset
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
    if (this.#preferences.pdfMode !== 'text') return
    const map = mapTextNodes(this.#reflow)
    this.#textOffset = Math.min(map.text.length, Math.max(0, Math.trunc(Number(offset) || 0)))
    if (!map.text || !this.#textOffset) return
    const range = map.rangeFor(Math.min(this.#textOffset,map.text.length - 1),Math.min(this.#textOffset + 1,map.text.length))
    const rect = range?.getClientRects?.()[0]
    if (rect) this.#container.scrollTo({ top:this.#container.scrollTop + rect.top - this.#container.getBoundingClientRect().top, behavior:'instant' })
  }

  #rememberTextPosition() {
    if (!this.#doc || this.#preferences.pdfMode !== 'text' || this.#reflow.hidden) return
    // A queued scroll event can arrive before ResizeObserver after rotation.
    // Those pixels belong to the new layout, not a new reading position.
    if (this.#resizeTimer != null) return
    if (this.#textLayoutChanged()) { this.#onResize(); return }
    const offset = this.#visibleTextOffset()
    if (offset === this.#textOffset) return
    this.#textOffset = offset
    this.#emitLocation()
  }

  #textLayoutChanged() {
    return Math.abs(this.#containerWidth() - this.#layoutWidth) >= 1 || this.#container.clientHeight !== this.#textHeight
  }

  #cancelResize() {
    clearTimeout(this.#resizeTimer)
    this.#resizeTimer = null
  }

  #settleTextResize() {
    if (!this.#doc || this.#preferences.pdfMode !== 'text' || this.#resizeTimer == null && !this.#textLayoutChanged()) return
    this.#cancelResize()
    clearTimeout(this.#scrollTimer)
    this.#layoutWidth = this.#containerWidth(); this.#textHeight = this.#container.clientHeight
    this.#restoreTextOffset(this.#textOffset)
  }

  #emitLocation() {
    if (!this.#doc) return
    this.#onRelocate({ index:this.#pageNum - 1,
      fraction:(this.#pageNum - 1) / Math.max(1, this.#doc.numPages - 1),
      ...(this.#textOffset > 0 ? { textOffset:this.#textOffset } : {}) })
  }

  async getLengthMetadata() {
    const pdf = this.#doc
    if (!pdf) return null
    if (this.#lengthMetadata?.pdf !== pdf) {
      this.#lengthMetadata = { pdf, promise:measurePDFBookLength(pdf, { isActive:() => this.#doc === pdf }) }
    }
    const result = await this.#lengthMetadata.promise
    return this.#doc === pdf ? result : null
  }

  async toggleZoom(clientX, clientY) {
    if (!this.#doc || this.#preferences.pdfMode === 'text') return
    this.#invalidateStagedSpeech()
    const containerRect = this.#container.getBoundingClientRect()
    const pageRect = this.#canvas.getBoundingClientRect()
    const x = clientX ?? containerRect.left + containerRect.width / 2
    const y = clientY ?? containerRect.top + containerRect.height / 2
    const width = pageRect.width || parseFloat(this.#canvas.style.width)
    const height = pageRect.height || parseFloat(this.#canvas.style.height)
    const focalX = Math.max(0, Math.min(1, (x - pageRect.left) / width))
    const focalY = Math.max(0, Math.min(1, (y - pageRect.top) / height))
    this.#zoomed = !this.#zoomed
    if (!await this.#render() || !this.#doc) return
    // Keep the same printed point under the tap, including an already scrolled
    // page and the PDF's desk margins, instead of jumping toward its corner.
    const updated = this.#canvas.getBoundingClientRect()
    this.#container.scrollTo({
      left:this.#container.scrollLeft + updated.left + focalX * (updated.width || parseFloat(this.#canvas.style.width)) - x,
      top:this.#container.scrollTop + updated.top + focalY * (updated.height || parseFloat(this.#canvas.style.height)) - y,
      behavior:'instant'
    })
  }

  #renderPreferences() {
    const p = this.#preferences
    return JSON.stringify([p.pdfMode, p.zoom, this.#zoomed, p.theme,
      ...(p.pdfMode === 'text' ? [p.font, p.fontSize, p.lineHeight, p.fontWeight, p.margin, p.align] : [])])
  }

  #renderKey() {
    return { doc:this.#doc, page:this.#pageNum, geometry:this.#speechGeometry(), preferences:this.#renderPreferences() }
  }

  #sameRenderKey(a, b) {
    return Boolean(a && b && a.doc === b.doc && a.page === b.page && a.preferences === b.preferences
      && a.geometry.every((value, index) => value === b.geometry[index]))
  }

  #renderRootsMatch(state) {
    return state && state.canvas === this.#canvas && state.textLayerEl === this.#textLayerEl
      && state.pageWrap === this.#pageWrap && state.reflow === this.#reflow
      && state.pageWrap.parentNode === this.#container && state.reflow.parentNode === this.#container
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
    if (this.#preferences.pdfMode === 'text') {
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
    const request = this.#renderRequest = { key }
    this.#renderReady = promise.finally(() => { if (this.#renderRequest === request) this.#renderRequest = null })
    return this.#renderReady
  }

  #render() {
    const key = this.#renderKey(), state = this.#renderState
    // A restore can arrive while the same page or its theme is still settling.
    // Await that work; only completed, unchanged pixels and text are reusable.
    if (this.#sameRenderKey(this.#renderRequest?.key, key) && this.#renderRootsMatch(state)) return this.#renderReady
    if (this.#sameRenderKey(state?.key, key) && this.#renderIsIntact(state)) return this.#renderReady
    return this.#trackRender(this.#renderPage(key), key)
  }

  #containerWidth() {
    return this.#container.clientWidth || this.#container.getBoundingClientRect().width || 360
  }

  #onResize() {
    if (this.#stagedSpeech && !this.#stagedSpeech.valid()) this.#invalidateStagedSpeech()
    if (!this.#doc) return
    if (this.#preferences.pdfMode === 'text') {
      if (!this.#textLayoutChanged()) return
      const offset = this.#textOffset, pdf = this.#doc, page = this.#pageNum
      clearTimeout(this.#scrollTimer)
      this.#layoutWidth = this.#containerWidth(); this.#textHeight = this.#container.clientHeight
      this.#cancelResize()
      this.#resizeTimer = setTimeout(() => {
        this.#resizeTimer = null
        if (this.#doc !== pdf || this.#pageNum !== page || this.#preferences.pdfMode !== 'text') return
        this.#restoreTextOffset(offset)
      }, 80)
      return
    }
    if (Math.abs(this.#containerWidth() - this.#layoutWidth) < 1) return
    clearTimeout(this.#resizeTimer)
    this.#resizeTimer = setTimeout(() => {
      this.#resizeTimer = null
      if (!this.#doc) return
      this.#render().catch(error => {
        if (this.#doc) console.warn('No se pudo adaptar la página al nuevo tamaño.', error)
      })
    }, 80)
  }

  async #renderPage(key) {
    const token = ++this.#renderToken
    this.#container.setAttribute('aria-busy', 'true')
    this.#invalidateStagedSpeech()
    this.#cancelRender(this.#renderState)
    this.#releaseOriginal(this.#renderState)
    const state = this.#renderState = {
      pageWrap:this.#pageWrap, canvas:this.#canvas, textLayerEl:this.#textLayerEl, reflow:this.#reflow, key
    }
    const page = await this.#doc.getPage(this.#pageNum)
    if (token !== this.#renderToken) return false
    const rendered = await this.#drawPage(page, state, () => token === this.#renderToken && Boolean(this.#doc))
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
    if (!this.#imageLayouts.has(page)) {
      this.#imageLayouts.set(page, page.getOperatorList
        ? page.getOperatorList().then(list => !hasUntrackedPDFImages(list, pdfjsLib.OPS))
        : Promise.resolve(false))
    }
    return this.#imageLayouts.get(page)
  }

  #useRenderedPage(state) {
    this.#pageText = state.pageText
    this.#baseScale = state.baseScale ?? this.#baseScale
    this.#layoutWidth = state.layoutWidth ?? this.#layoutWidth
    this.#container.dataset.readerZoomed = String(state.zoomed)
    this.#container.setAttribute('aria-busy', 'false')
    this.#rememberRenderedPage(state)
  }

  // The same PDF.js rendering and mapping produce visible and staged pages. A staged
  // canvas/TextLayer stays detached until the engine reports its first audible sample.
  async #drawPage(page, state, valid, content) {
    const { pageWrap, canvas, textLayerEl, reflow } = state
    state.page = page
    const textMode = this.#preferences.pdfMode === 'text'
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
      this.#textHeight = this.#container.clientHeight
      return true
    }

    const containerWidth = this.#containerWidth()
    const unscaledViewport = page.getViewport({ scale: 1 })
    // Fit the entire original page width. A minimum scale of .6 overflowed
    // ordinary A4 PDFs on narrow phones and made text/selection disagree.
    state.baseScale = containerWidth / unscaledViewport.width
    state.layoutWidth = containerWidth
    const scale = state.baseScale * (this.#zoomed ? ZOOM_STEP_SCALE : this.#preferences.zoom / 100)
    state.zoomed = this.#zoomed || this.#preferences.zoom > 100

    const dpr = window.devicePixelRatio || 1
    const viewport = page.getViewport({ scale: scale * dpr })

    canvas.width = viewport.width
    canvas.height = viewport.height
    canvas.style.width = `${viewport.width / dpr}px`
    canvas.style.height = `${viewport.height / dpr}px`

    const themeFilter = PDF_PAGE_FILTERS[this.#preferences.theme]
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
    if (original !== canvas && !await this.#paintTheme(state, this.#preferences.theme, valid)) return false

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
    const state = this.#renderState
    const valid = () => Boolean(this.#doc) && state === this.#renderState
      && preferences.theme === this.#preferences.theme && preferences.pdfMode === this.#preferences.pdfMode
      && preferences.zoom === this.#preferences.zoom
    if (!valid() || !state?.originalCanvas) return false
    const painted = await this.#paintTheme(state, preferences.theme, valid)
    if (painted) {
      state.key = { ...state.key, preferences:this.#renderPreferences() }
      this.#rememberRenderedPage(state)
      this.#container.setAttribute('aria-busy', 'false')
    }
    return painted
  }

  async getSpeechText() {
    if (!this.#doc) return ''
    const page = await this.#doc.getPage(this.#pageNum)
    const text = await page.getTextContent()
    return extractPDFText(text, page.getViewport({ scale:1 })).text
  }
  #speechMap() {
    return this.#preferences.pdfMode === 'text'
      ? mapTextNodes(this.#reflow)
      : mapPDFTextLayer(this.#textLayerEl, this.#renderState?.textLayout) || mapTextLayer(this.#textLayerEl)
  }

  /** The page's text as the audiobook reads it, mapped onto the rendered text layer (or the reflow text) it is highlighted in. */
  async getSpeechSource() {
    if (!this.#doc) return null
    let pending
    do { pending = this.#renderReady; await pending } while (this.#doc && pending !== this.#renderReady)
    if (!this.#doc) return null
    return this.#makeSpeechSource(this.#pageNum, this.#speechMap(), this.#renderState?.textLayout).source
  }

  #makeSpeechSource(page, first, textLayout) {
    const pdf = this.#doc
    const doc = this.#container.ownerDocument
    installSpeechStyle(doc, this.#preferences.theme)
    let map = first, marked = []
    const mappedToVisiblePage = () => {
      const node = map.spans[0]?.node
      const root = this.#preferences.pdfMode === 'text' ? this.#reflow : this.#textLayerEl
      return !node || node.isConnected && root.contains(node)
    }
    // A zoom or view change re-renders the layer under a paused voice: re-map it, but only if it is still this page's text.
    const current = () => {
      if (this.#doc === pdf && page === this.#pageNum && !mappedToVisiblePage()) {
        const again = this.#speechMap()
        // TextLayer omits the final item's separator; reflow retains it. Only this
        // trailing whitespace may differ: every spoken character keeps its raw offset.
        if (again.text.trimEnd() === first.text.trimEnd()) map = again
      }
      return this.#doc === pdf && page === this.#pageNum && mappedToVisiblePage() ? map : null
    }
    const clear = () => {
      clearSpeechRange(doc)
      for (const element of marked) element.classList.remove(SPEECH_SPAN_CLASS)
      marked = []
    }
    const source = {
      text:first.text, start:0, clear,
      // Geometric paragraphs are real body text, including repeated dialogue.
      // No marginal header is confirmed by page-local layout alone: preserve
      // those paragraphs even when the legacy header-skipping option is on.
      ...(textLayout?.geometric || this.#preferences.pdfMode === 'text' ? { headerRanges:Object.freeze([]) } : {}),
      highlight:(start, end) => {
        const live = current(), range = live?.rangeFor(start, end)
        clear()
        if (!range) return
        if (paintSpeechRange(range)) return
        // Fallback for WebViews without the Highlight API: tint the text-layer spans (or reflow page) the sentence touches.
        marked = live.spans.filter(span => span.end > start && span.start < end).map(span => span.node.parentElement)
        for (const element of marked) element.classList.add(SPEECH_SPAN_CLASS)
      },
      follow:(start, end) => {
        this.#settleTextResize()
        const rect = current()?.rangeFor(start, end)?.getClientRects()[0]
        if (!rect) return
        const box = this.#container.getBoundingClientRect()
        // Zoomed pages and the text view scroll: keep the sentence in view, a third from the top, without jolting while it is already visible.
        const lower = rect.bottom > box.bottom - 24 || rect.top < box.top + 8
        const side = rect.right > box.right || rect.left < box.left
        if (!lower && !side) return
        this.#container.scrollBy({
          top:lower ? rect.top - (box.top + box.height * .3) : 0, left:side ? rect.left - (box.left + box.width * .15) : 0,
          behavior:window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'
        })
      }
    }
    return { source, current }
  }

  #speechGeometry() {
    const rect = this.#container.getBoundingClientRect()
    return [this.#containerWidth(), this.#container.clientHeight || rect.height, window.devicePixelRatio || 1]
  }

  #invalidateStagedSpeech() {
    const staged = this.#stagedSpeech
    if (!staged) return
    this.#stagedSpeech = null
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
  async getNextSpeechSource({ isActive = () => true } = {}) {
    this.#invalidateStagedSpeech()
    if (!this.#doc || !isActive()) throw speechCancelled()
    const pdf = this.#doc, previousPage = this.#pageNum, token = this.#renderToken, preferences = this.#preferences
    const request = ++this.#speechRequest, geometry = this.#speechGeometry(), pending = this.#renderReady
    const unchanged = () => this.#doc === pdf && this.#pageNum === previousPage && this.#renderToken === token
      && this.#preferences === preferences && request === this.#speechRequest && isActive()
      && geometry.every((value, index) => value === this.#speechGeometry()[index])
    await pending
    if (!unchanged() || pending !== this.#renderReady) throw speechCancelled()
    if (previousPage === pdf.numPages) return null
    const staged = {
      pageWrap:this.#pageWrap.cloneNode(false), canvas:this.#canvas.cloneNode(false),
      textLayerEl:this.#textLayerEl.cloneNode(false), reflow:this.#reflow.cloneNode(false), invalid:false
    }
    staged.reflow.classList.remove(SPEECH_SPAN_CLASS)
    staged.pageWrap.append(staged.canvas, staged.textLayerEl)
    staged.valid = () => !staged.invalid && this.#stagedSpeech === staged && unchanged()
    this.#stagedSpeech = staged
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
        source.isValid = () => activated ? Boolean(current()) : staged.valid()
        source.activate = () => {
          if (activated) return Boolean(current())
          if (!staged.valid()) { source.clear(); return false }
          this.#stagedSpeech = null
          this.#cancelRender(this.#renderState)
          this.#releaseOriginal(this.#renderState)
          clearPDFReflow(this.#reflow)
          ++this.#renderToken
          const oldCanvas = this.#canvas
          this.#pageWrap.replaceWith(staged.pageWrap)
          this.#reflow.replaceWith(staged.reflow)
          this.#pageWrap = staged.pageWrap; this.#canvas = staged.canvas
          this.#textLayerEl = staged.textLayerEl; this.#reflow = staged.reflow
          this.#renderState = staged
          this.#cancelResize()
          this.#renderRequest = null
          this.#renderReady = Promise.resolve(true)
          this.#pageNum = number
          this.#useRenderedPage(staged)
          clearTimeout(this.#scrollTimer)
          this.#container.scrollTop = 0
          this.#textOffset = 0
          oldCanvas.width = oldCanvas.height = 0
          activated = true
          this.#emitLocation()
          return true
        }
        source.clear = () => {
          if (activated) clear()
          else {
            if (this.#stagedSpeech === staged) this.#invalidateStagedSpeech()
            else staged.invalid = true
          }
        }
        return source
      }
      throw new Error('Página siguiente sin texto legible.')
    } catch (error) {
      const cancelled = !staged.valid()
      if (this.#stagedSpeech === staged) this.#invalidateStagedSpeech()
      throw cancelled ? speechCancelled() : error
    }
  }

  /** The restored reading page, copied only after its latest render settles. */
  async getPageSnapshot({ reuseSettledLayout = false } = {}) {
    if (!this.#doc) return null
    let pending
    do {
      pending = this.#renderReady
      await pending
    } while (this.#doc && pending !== this.#renderReady)
    if (!this.#doc) return null
    const textMode = this.#preferences.pdfMode === 'text'
    // An explicit snapshot can arrive before ResizeObserver's delayed render.
    // Finish that exact render first, preserving the page, text and resolution.
    if (reuseSettledLayout && !textMode && (!this.#sameRenderKey(this.#renderState?.key, this.#renderKey())
        || !this.#renderIsIntact(this.#renderState))) {
      this.#cancelResize()
      await this.#render()
      return this.getPageSnapshot({ reuseSettledLayout })
    }
    // Completed physical pixels need no additional paints when their layout
    // and text are intact. DOM text still waits for fonts and both frames.
    const settledPhysical = reuseSettledLayout && !textMode && this.#resizeTimer == null
      && this.#sameRenderKey(this.#renderState?.key, this.#renderKey()) && this.#renderIsIntact(this.#renderState)
    if (!settledPhysical) await settlePageLayout(this.#container.ownerDocument, { waitForFonts:textMode })
    if (!this.#doc || pending !== this.#renderReady
      || textMode !== (this.#preferences.pdfMode === 'text')) return this.getPageSnapshot({ reuseSettledLayout })
    const page = this.#pageNum
    if (textMode) { this.#settleTextResize(); this.#rememberTextPosition() }
    // Physical white pages blend into the current reader theme on opening.
    const theme = READING_THEMES[this.#preferences.theme]
    const canvasFilter = textMode ? null : renderedPageFilter(this.#canvas)
    const snapshot = textMode
      ? await snapshotDOMPage(this.#reflow, {
        paper:{ background:'#ffffff', color:'#292821', themeColor:theme.color },
        viewport:this.#container.getBoundingClientRect(),
        offsetX:this.#container.getBoundingClientRect().left,
        offsetY:this.#container.getBoundingClientRect().top,
        background:getComputedStyle(this.#reflow).backgroundColor,
        filter:renderedPageFilter(this.#reflow)
      })
      : snapshotCanvas(this.#canvas, {
        filter:canvasFilter, displayBounds:this.#canvas.getBoundingClientRect(),
        paper:true, paperSource:this.#renderState?.originalCanvas || this.#canvas
      })
    if (!snapshot || !this.#doc || page !== this.#pageNum) return null
    if (!textMode) {
      // Each snapshot still owns fresh copies of the exact page pixels. Reuse
      // only its margin-colour measurement while the settled raster, source
      // dimensions and applied filter remain identical. Navigation, rendering,
      // zoom, theme or brightness changes invalidate both opaque tokens.
      const original = this.#renderState?.originalCanvas || this.#canvas
      const facts = [this.#doc, pending, this.#renderToken, this.#canvas,
        this.#canvas.width, this.#canvas.height, original, original.width,
        original.height, canvasFilter]
      if (!this.#snapshotToneState || facts.some((value, i) => value !== this.#snapshotToneState.facts[i])) {
        this.#snapshotToneState?.controller.abort()
        this.#snapshotToneState = { facts, theme:Object.freeze({}), paper:Object.freeze({}), themeRaster:Object.freeze({}), paperRaster:Object.freeze({}), controller:new AbortController() }
      }
      snapshot.toneKey = this.#snapshotToneState.theme
      if (snapshot.paper) snapshot.paper.toneKey = this.#snapshotToneState.paper
      const state = this.#snapshotToneState
      // Both copies use the exact same source, filter and resampling when the
      // physical page is already unfiltered white paper. Share only that proven
      // raster's tone and texture revision; changed themes retain separate maps.
      const samePaper = original === this.#canvas && canvasFilter === 'none'
      if (samePaper && snapshot.paper) sharePaperTone(state.paper, state.theme)
      await prepareSnapshotPaperTones(snapshot, { signal:state.controller.signal })
      if (!this.#doc) return null
      if (state !== this.#snapshotToneState || pending !== this.#renderReady || page !== this.#pageNum
        || facts[2] !== this.#renderToken || this.#preferences.pdfMode === 'text'
        || facts[4] !== this.#canvas.width || facts[5] !== this.#canvas.height
        || facts[7] !== original.width || facts[8] !== original.height
        || canvasFilter !== renderedPageFilter(this.#canvas)
        || settledPhysical && !this.#sameRenderKey(this.#renderState?.key, this.#renderKey())) return this.getPageSnapshot({ reuseSettledLayout })
      registerPageRaster(snapshot.source, state.themeRaster)
      if (snapshot.paper) registerPageRaster(snapshot.paper.source, samePaper ? state.themeRaster : state.paperRaster)
    } else {
      this.#snapshotToneState?.controller.abort()
      this.#snapshotToneState = undefined
    }
    return { ...snapshot, engine:'pdf', sourceType:textMode ? 'pdf-text' : 'pdf-canvas',
      text:snapshot.text || this.#pageText, label:`Página ${page} de ${this.pageCount}`,
      location:{ fraction:(page - 1) / Math.max(1, this.pageCount - 1), locator:{ kind:'pdf-page', value:page,
        ...(this.#textOffset > 0 ? { textOffset:this.#textOffset } : {}) } } }
  }
  async search(query) {
    const term = String(query || '').trim().toLocaleLowerCase()
    if (!term || !this.#doc) return []
    const results = []
    for (let pageNumber = 1; pageNumber <= this.pageCount; pageNumber++) {
      const page = await this.#doc.getPage(pageNumber)
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
    const previous = this.#preferences
    this.#settleTextResize()
    this.#cancelResize()
    const offset = previous.pdfMode === 'text' ? this.#visibleTextOffset() : this.#textOffset
    if (this.#doc && previous.pdfMode === 'text' && offset !== this.#textOffset) {
      this.#textOffset = offset
      this.#emitLocation()
    }
    this.#preferences = normalizeReadingPreferences(preferences)
    const p = this.#preferences
    this.#applyTextStyles()
    if (this.#doc && (previous.pdfMode !== p.pdfMode || previous.zoom !== p.zoom)) await this.#render()
    else if (this.#doc && p.pdfMode !== 'text' && previous.theme !== p.theme) {
      this.#container.setAttribute('aria-busy', 'true')
      const ready = this.#renderReady
      await this.#trackRender(this.#retheme(ready, p), this.#renderKey())
    }
    this.#textOffset = offset
    if (this.#doc && p.pdfMode === 'text') {
      clearTimeout(this.#scrollTimer)
      this.#restoreTextOffset(offset)
    }
  }

  #applyTextStyles() {
    const p = this.#preferences
    Object.assign(this.#reflow.style, {
      fontFamily:READING_FONTS[p.font], fontSize:`${p.fontSize}px`, lineHeight:String(p.lineHeight),
      fontWeight:String(p.fontWeight), padding:`12px ${p.margin}px`, textAlign:p.align
    })
  }

  /** Miniatura de la página 1 como Blob, para la portada de la estantería. */
  async getCoverBlob({ signal, retainOnClose = false } = {}) {
    const doc = this.#doc
    const loading = this.#loadingTask
    if (!doc || signal?.aborted) return null
    // A first cover belongs to this captured document, even if its reader UI
    // closes. Other optional HD jobs keep their original cancellation policy.
    let retained
    if (retainOnClose && loading) {
      retained = this.#retainedCovers.get(loading)
      if (!retained) this.#retainedCovers.set(loading, retained = { count:0, closing:false })
      retained.count++
    }
    const current = () => !signal?.aborted && (this.#doc === doc || retained?.closing === true)
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
        this.#retainedCovers.delete(loading)
        if (retained.closing) {
          try { await loading.destroy() }
          catch (error) { console.warn('No se pudo liberar el PDF de la portada:', error) }
        }
      }
    }
  }

  close() {
    this.#resizeObserver?.disconnect()
    this.#resizeObserver = null
    clearTimeout(this.#resizeTimer)
    this.#resizeTimer = null
    clearTimeout(this.#scrollTimer)
    this.#scrollTimer = null
    this.#detachScroll()
    this.#detachScroll = () => {}
    this.#textOffset = 0
    this.#textHeight = 0
    this.#lengthMetadata = null
    this.#layoutWidth = 0
    ++this.#renderToken
    this.#invalidateStagedSpeech()
    this.#cancelRender(this.#renderState)
    this.#releaseOriginal(this.#renderState)
    if (this.#reflow) clearPDFReflow(this.#reflow)
    this.#renderState = null
    this.#renderRequest = null
    this.#detachGestures()
    // PDFDocumentProxy no expone destroy(): la limpieza vive en el
    // loadingTask (ver pdfjs-dist/build/pdf.mjs, PDFDocumentLoadingTask).
    const loading = this.#loadingTask, retained = this.#retainedCovers.get(loading)
    if (retained) retained.closing = true
    else loading?.destroy()
    this.#loadingTask = null
    this.#doc = null
    this.#imageLayouts = new WeakMap()
    this.#snapshotToneState?.controller.abort()
    this.#snapshotToneState = undefined
    this.#pageText = ''
    if (this.#container) {
      this.#container.innerHTML = ''
      this.#container.classList.remove('pdf-reader')
      this.#container.removeAttribute('aria-busy')
      delete this.#container.dataset.readerZoomed
    }
  }
}
