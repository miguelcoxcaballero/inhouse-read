// Lector de PDF sobre PDF.js. Renderiza página a página en un <canvas>,
// con una capa de texto seleccionable encima, y expone gestos táctiles
// (swipe, tap en los bordes, doble-tap para zoom) pensados para móvil.
//
// Deliberadamente NO usa un <iframe>/visor nativo: PDF.js en modo "canvas
// por página" es lo que permite igualar el look & feel del resto de la app
// (misma UI de progreso, mismos gestos que en el lector de EPUB/MOBI).

import * as pdfjsLib from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { TextLayer } from 'pdfjs-dist'
import { attachSwipeNavigation } from '../gestures.js'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

const MIN_SCALE = 0.6
const MAX_SCALE = 3
const ZOOM_STEP_SCALE = 2.2

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

  async open(container, arrayBuffer, { onRelocate, onToggleChrome } = {}) {
    this.#container = container
    this.#onRelocate = onRelocate ?? (() => {})

    this.#loadingTask = pdfjsLib.getDocument({ data: arrayBuffer })
    this.#doc = await this.#loadingTask.promise

    container.innerHTML = ''
    container.classList.add('pdf-reader')

    this.#pageWrap = document.createElement('div')
    this.#pageWrap.className = 'pdf-page-wrap'
    this.#canvas = document.createElement('canvas')
    this.#canvas.className = 'pdf-page-canvas'
    this.#textLayerEl = document.createElement('div')
    this.#textLayerEl.className = 'pdf-text-layer'

    this.#pageWrap.append(this.#canvas, this.#textLayerEl)
    container.append(this.#pageWrap)

    this.#detachGestures = attachSwipeNavigation(container, {
      onNext: () => this.next(),
      onPrev: () => this.prev(),
      onToggleZoom: (x, y) => this.toggleZoom(x, y),
      onToggleChrome
    })

    await this.goToPage(1)
  }

  get pageCount() {
    return this.#doc?.numPages ?? 0
  }

  get currentPage() {
    return this.#pageNum
  }

  async goToPage(n) {
    if (!this.#doc) return
    const clamped = Math.min(Math.max(1, n), this.#doc.numPages)
    this.#pageNum = clamped
    await this.#render()
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
    this.#zoomed = !this.#zoomed
    await this.#render()
    if (this.#zoomed) {
      const rect = this.#container.getBoundingClientRect()
      this.#container.scrollTo({
        left: (clientX - rect.left) * (ZOOM_STEP_SCALE - 1),
        top: (clientY - rect.top) * (ZOOM_STEP_SCALE - 1),
        behavior: 'instant'
      })
    }
  }

  async #render() {
    const token = ++this.#renderToken
    const page = await this.#doc.getPage(this.#pageNum)
    if (token !== this.#renderToken) return

    const containerWidth = this.#container.clientWidth || 360
    const unscaledViewport = page.getViewport({ scale: 1 })
    this.#baseScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, containerWidth / unscaledViewport.width))
    const scale = this.#baseScale * (this.#zoomed ? ZOOM_STEP_SCALE : 1)

    const dpr = window.devicePixelRatio || 1
    const viewport = page.getViewport({ scale: scale * dpr })

    this.#canvas.width = viewport.width
    this.#canvas.height = viewport.height
    this.#canvas.style.width = `${viewport.width / dpr}px`
    this.#canvas.style.height = `${viewport.height / dpr}px`

    const ctx = this.#canvas.getContext('2d')
    await page.render({ canvasContext: ctx, viewport }).promise
    if (token !== this.#renderToken) return

    // Capa de texto seleccionable, alineada 1:1 con el canvas ya renderizado.
    this.#textLayerEl.replaceChildren()
    this.#textLayerEl.style.width = `${viewport.width / dpr}px`
    this.#textLayerEl.style.height = `${viewport.height / dpr}px`
    const cssViewport = page.getViewport({ scale })
    const textContent = await page.getTextContent()
    const textLayer = new TextLayer({
      textContentSource: textContent,
      container: this.#textLayerEl,
      viewport: cssViewport
    })
    await textLayer.render()
  }

  /** Miniatura de la página 1 como Blob, para la portada de la estantería. */
  async getCoverBlob() {
    if (!this.#doc) return null
    const page = await this.#doc.getPage(1)
    const viewport = page.getViewport({ scale: 1 })
    const targetWidth = 300
    const scale = targetWidth / viewport.width
    const thumbViewport = page.getViewport({ scale })

    const canvas = document.createElement('canvas')
    canvas.width = thumbViewport.width
    canvas.height = thumbViewport.height
    await page.render({ canvasContext: canvas.getContext('2d'), viewport: thumbViewport }).promise

    return new Promise(resolve => canvas.toBlob(resolve, 'image/webp', 0.85))
  }

  close() {
    this.#detachGestures()
    // PDFDocumentProxy no expone destroy(): la limpieza vive en el
    // loadingTask (ver pdfjs-dist/build/pdf.mjs, PDFDocumentLoadingTask).
    this.#loadingTask?.destroy()
    this.#loadingTask = null
    this.#doc = null
    if (this.#container) this.#container.innerHTML = ''
  }
}
