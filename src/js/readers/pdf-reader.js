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
import { attachSwipeNavigation } from '../gestures.js'
import { DEFAULT_READING_PREFERENCES, PDF_PAGE_FILTERS, READING_FONTS, READING_THEMES, normalizeReadingPreferences } from './reading-preferences.js'
import { hasUntrackedPDFImages, paintPDFTheme } from './pdf-page-theme.js'
import { renderedPageFilter, settlePageLayout, snapshotCanvas, snapshotDOMPage } from './page-snapshot.js'
import { mapTextLayer, mapTextNode } from './speech-map.js'
import { SPEECH_SPAN_CLASS, clearSpeechRange, installSpeechStyle, paintSpeechRange } from './speech-highlight.js'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

const ZOOM_STEP_SCALE = 2.2
const MAX_EMPTY_SPEECH_PAGES = 12
const pageText = content => content.items.filter(item => typeof item.str === 'string')
  .map(item => item.str + (item.hasEOL ? '\n' : ' ')).join('')
const speechCancelled = () => new DOMException('La preparación de la página ha cambiado.', 'AbortError')

export class PdfReader {
  #container
  #loadingTask
  #doc
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
  #pageText = ''
  #resizeObserver
  #resizeTimer
  #layoutWidth = 0
  #imageLayouts = new WeakMap()

  async open(container, arrayBuffer, { onRelocate, onToggleChrome, onUserNavigation } = {}) {
    this.#container = container
    this.#onRelocate = onRelocate ?? (() => {})

    this.#loadingTask = pdfjsLib.getDocument({ data: arrayBuffer })
    this.#doc = await this.#loadingTask.promise

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

    await this.goToPage(1)
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

  async goToPage(n) {
    if (!this.#doc) return
    this.#invalidateStagedSpeech()
    const clamped = Math.min(Math.max(1, Math.round(Number(n) || 1)), this.#doc.numPages)
    this.#pageNum = clamped
    const rendered = await this.#render()
    if (!rendered || this.#pageNum !== clamped) return
    this.#container.scrollTop = 0
    this.#onRelocate({
      index: this.#pageNum - 1,
      fraction: (this.#pageNum - 1) / Math.max(1, this.#doc.numPages - 1 || 1)
    })
  }

  async next() {
    if (this.#pageNum < this.pageCount) await this.goToPage(this.#pageNum + 1)
  }

  async prev() {
    if (this.#pageNum > 1) await this.goToPage(this.#pageNum - 1)
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

  #render() {
    this.#renderReady = this.#renderPage()
    return this.#renderReady
  }

  #containerWidth() {
    return this.#container.clientWidth || this.#container.getBoundingClientRect().width || 360
  }

  #onResize() {
    if (this.#stagedSpeech && !this.#stagedSpeech.valid()) this.#invalidateStagedSpeech()
    if (!this.#doc || this.#preferences.pdfMode === 'text') return
    if (Math.abs(this.#containerWidth() - this.#layoutWidth) < 1) return
    clearTimeout(this.#resizeTimer)
    this.#resizeTimer = setTimeout(() => {
      if (!this.#doc) return
      this.#render().catch(error => {
        if (this.#doc) console.warn('No se pudo adaptar la página al nuevo tamaño.', error)
      })
    }, 80)
  }

  async #renderPage() {
    const token = ++this.#renderToken
    this.#container.setAttribute('aria-busy', 'true')
    this.#invalidateStagedSpeech()
    this.#cancelRender(this.#renderState)
    this.#releaseOriginal(this.#renderState)
    const state = this.#renderState = {
      pageWrap:this.#pageWrap, canvas:this.#canvas, textLayerEl:this.#textLayerEl, reflow:this.#reflow
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
      state.pageText = pageText(content)
      reflow.textContent = state.pageText || 'Esta página es una imagen. Cambia a Página original para verla.'
      state.zoomed = false
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
    state.pageText = pageText(textContent)
    const textLayer = new TextLayer({
      textContentSource: textContent,
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
    return valid()
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
    const valid = () => Boolean(this.#doc) && state === this.#renderState && preferences === this.#preferences
    if (!valid() || !state?.originalCanvas) return false
    const painted = await this.#paintTheme(state, preferences.theme, valid)
    if (painted) this.#container.setAttribute('aria-busy', 'false')
    return painted
  }

  async getSpeechText() {
    if (!this.#doc) return ''
    const page = await this.#doc.getPage(this.#pageNum)
    const text = await page.getTextContent()
    return pageText(text)
  }
  #speechMap() {
    return this.#preferences.pdfMode === 'text'
      ? mapTextNode(this.#pageText ? this.#reflow.firstChild : null) : mapTextLayer(this.#textLayerEl)
  }

  /** The page's text as the audiobook reads it, mapped onto the rendered text layer (or the reflow text) it is highlighted in. */
  async getSpeechSource() {
    if (!this.#doc) return null
    let pending
    do { pending = this.#renderReady; await pending } while (this.#doc && pending !== this.#renderReady)
    if (!this.#doc) return null
    return this.#makeSpeechSource(this.#pageNum, this.#speechMap()).source
  }

  #makeSpeechSource(page, first) {
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
    staged.reflow.replaceChildren()
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
        if (!pageText(content).trim()) {
          if (number === pdf.numPages) { this.#invalidateStagedSpeech(); return null }
          continue
        }
        if (!await this.#drawPage(page, staged, staged.valid, content)) throw speechCancelled()
        const first = preferences.pdfMode === 'text'
          ? mapTextNode(staged.reflow.firstChild) : mapTextLayer(staged.textLayerEl)
        if (!first.text.trim()) throw new Error('No se pudo preparar el texto de la página siguiente.')
        const { source, current } = this.#makeSpeechSource(number, first)
        const clear = source.clear
        let activated = false
        source.isValid = () => activated ? Boolean(current()) : staged.valid()
        source.activate = () => {
          if (activated) return Boolean(current())
          if (!staged.valid()) { source.clear(); return false }
          this.#stagedSpeech = null
          this.#cancelRender(this.#renderState)
          this.#releaseOriginal(this.#renderState)
          ++this.#renderToken
          const oldCanvas = this.#canvas
          this.#pageWrap.replaceWith(staged.pageWrap)
          this.#reflow.replaceWith(staged.reflow)
          this.#pageWrap = staged.pageWrap; this.#canvas = staged.canvas
          this.#textLayerEl = staged.textLayerEl; this.#reflow = staged.reflow
          this.#renderState = staged
          this.#renderReady = Promise.resolve(true)
          this.#pageNum = number
          this.#useRenderedPage(staged)
          this.#container.scrollTop = 0
          oldCanvas.width = oldCanvas.height = 0
          activated = true
          this.#onRelocate({ index:number - 1, fraction:(number - 1) / Math.max(1, pdf.numPages - 1) })
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
  async getPageSnapshot() {
    if (!this.#doc) return null
    let pending
    do {
      pending = this.#renderReady
      await pending
    } while (this.#doc && pending !== this.#renderReady)
    if (!this.#doc) return null
    await settlePageLayout(this.#container.ownerDocument)
    if (!this.#doc || pending !== this.#renderReady) return this.getPageSnapshot()
    const page = this.#pageNum
    const textMode = this.#preferences.pdfMode === 'text'
    // Physical white pages blend into the current reader theme on opening.
    const theme = READING_THEMES[this.#preferences.theme]
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
        filter:renderedPageFilter(this.#canvas), displayBounds:this.#canvas.getBoundingClientRect(),
        paper:true, paperSource:this.#renderState?.originalCanvas || this.#canvas
      })
    if (!snapshot || !this.#doc || page !== this.#pageNum) return null
    return { ...snapshot, engine:'pdf', sourceType:textMode ? 'pdf-text' : 'pdf-canvas',
      text:snapshot.text || this.#pageText, label:`Página ${page} de ${this.pageCount}`,
      location:{ fraction:(page - 1) / Math.max(1, this.pageCount - 1), locator:{ kind:'pdf-page', value:page } } }
  }
  async search(query) {
    const term = String(query || '').trim().toLocaleLowerCase()
    if (!term || !this.#doc) return []
    const results = []
    for (let pageNumber = 1; pageNumber <= this.pageCount; pageNumber++) {
      const page = await this.#doc.getPage(pageNumber)
      const content = await page.getTextContent()
      const text = content.items.map(item => item.str).join(' ').replace(/\s+/g,' ').trim()
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
    this.#preferences = normalizeReadingPreferences(preferences)
    const p = this.#preferences
    Object.assign(this.#reflow.style, {
      fontFamily:READING_FONTS[p.font], fontSize:`${p.fontSize}px`, lineHeight:String(p.lineHeight),
      fontWeight:String(p.fontWeight), padding:`12px ${p.margin}px`, textAlign:p.align
    })
    if (this.#doc && (previous.pdfMode !== p.pdfMode || previous.zoom !== p.zoom)) await this.#render()
    else if (this.#doc && p.pdfMode !== 'text' && previous.theme !== p.theme) {
      this.#container.setAttribute('aria-busy', 'true')
      const ready = this.#renderReady
      this.#renderReady = this.#retheme(ready, p)
      await this.#renderReady
    }
  }

  /** Miniatura de la página 1 como Blob, para la portada de la estantería. */
  async getCoverBlob() {
    if (!this.#doc) return null
    const page = await this.#doc.getPage(1)
    const viewport = page.getViewport({ scale: 1 })
    // La portada se ve a casi tamaño real durante la apertura. 300 px daba
    // miniaturas blandas en pantallas móviles; renderizamos hasta 1200 px,
    // con un límite de 1600 px por el lado mayor y sin ampliar el PDF más de 3×.
    const scale = Math.min(3, 1600 / Math.max(viewport.width, viewport.height), 1200 / viewport.width)
    const thumbViewport = page.getViewport({ scale })

    const canvas = document.createElement('canvas')
    canvas.width = thumbViewport.width
    canvas.height = thumbViewport.height
    await page.render({ canvasContext: canvas.getContext('2d'), viewport: thumbViewport }).promise

    // JPEG: la portada es opaca y su codificación es mucho más rápida que WebP
    // en el hilo principal (WebP bloqueaba segundos la vuelta a la estantería).
    return new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.9))
  }

  close() {
    this.#resizeObserver?.disconnect()
    this.#resizeObserver = null
    clearTimeout(this.#resizeTimer)
    this.#resizeTimer = null
    this.#layoutWidth = 0
    ++this.#renderToken
    this.#invalidateStagedSpeech()
    this.#cancelRender(this.#renderState)
    this.#releaseOriginal(this.#renderState)
    this.#renderState = null
    this.#detachGestures()
    // PDFDocumentProxy no expone destroy(): la limpieza vive en el
    // loadingTask (ver pdfjs-dist/build/pdf.mjs, PDFDocumentLoadingTask).
    this.#loadingTask?.destroy()
    this.#loadingTask = null
    this.#doc = null
    this.#imageLayouts = new WeakMap()
    this.#pageText = ''
    if (this.#container) {
      this.#container.innerHTML = ''
      this.#container.classList.remove('pdf-reader')
      this.#container.removeAttribute('aria-busy')
      delete this.#container.dataset.readerZoomed
    }
  }
}
