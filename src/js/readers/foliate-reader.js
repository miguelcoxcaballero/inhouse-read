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

import 'foliate-js/view.js'
import { Overlayer } from 'foliate-js/overlayer.js'
import { attachSwipeNavigation } from '../gestures.js'
import { DEFAULT_READING_PREFERENCES, readingCSS, normalizeReadingPreferences } from './reading-preferences.js'

export class FoliateReader {
  #view
  #container
  #onRelocate = () => {}
  #detachGestures = () => {}
  #preferences = { ...DEFAULT_READING_PREFERENCES }
  #documentGestures = []

  async open(container, file, { onRelocate, onToggleChrome, onUserNavigation, onFollowLink } = {}) {
    this.#container = container
    this.#onRelocate = onRelocate ?? (() => {})

    container.innerHTML = ''
    container.classList.add('foliate-reader')
    container.classList.remove('pdf-reader')

    this.#view = document.createElement('foliate-view')
    this.#view.classList.add('foliate-view-el')
    container.append(this.#view)

    // foliate-js es deliberadamente de bajo nivel y no trae gestos táctiles
    // propios (ver HANDOFF-FORMATOS.md): reusamos el mismo detector de
    // swipe/tap que el lector de PDF para que la sensación táctil sea
    // idéntica entre formatos.
    const gestures = {
      onNext: () => { onUserNavigation?.(); return this.next() },
      onPrev: () => { onUserNavigation?.(); return this.prev() },
      onToggleChrome
    }
    this.#detachGestures = attachSwipeNavigation(container, gestures)
    this.#view.addEventListener('load', event => {
      // Events inside the book iframe do not bubble to the outer viewport.
      this.#documentGestures.push(attachSwipeNavigation(event.detail.doc.documentElement, gestures))
      event.detail.doc.addEventListener('selectionchange', () => {
        const selection = event.detail.doc.defaultView.getSelection()
        if (!selection?.toString().trim() || !selection.rangeCount) return
        window.dispatchEvent(new CustomEvent('inhouse-reader-selection',{detail:{
          text:selection.toString().trim(),locator:{kind:'cfi',value:this.#view.getCFI(event.detail.index,selection.getRangeAt(0))}
        }}))
      })
    })
    this.#view.addEventListener('link', event => {
      if (onFollowLink) { event.preventDefault(); onFollowLink(event.detail.href) }
    })
    this.#view.addEventListener('draw-annotation', event => {
      const { draw, annotation } = event.detail
      const colors = {green:'#75ad6b66',blue:'#74a6d866',pink:'#df8dad66',yellow:'#f2d35d77'}
      draw(Overlayer.highlight, {color:colors[annotation.color] || colors.yellow})
    })

    this.#view.addEventListener('relocate', e => {
      this.#onRelocate({
        index: e.detail.index,
        fraction: e.detail.fraction ?? 0,
        cfi: e.detail.cfi,
        section:e.detail.tocItem?.label || '', page:e.detail.pageItem?.label || ''
      })
    })

    await this.#view.open(file)
    await this.#view.init({ showTextStart: true })
    this.#applyReaderStyles()
  }

  get metadata() {
    return this.#view?.book?.metadata ?? {}
  }

  get toc() {
    return this.#view?.book?.toc ?? []
  }

  /** Portada embebida del libro (EPUB/MOBI), si el archivo trae una. */
  async getCoverBlob() {
    try {
      return (await this.#view?.book?.getCover?.()) ?? null
    } catch {
      return null // una portada rota no puede impedir leer el libro
    }
  }

  async next() {
    await this.#view?.next()
  }

  async prev() {
    await this.#view?.prev()
  }

  async goToFraction(fraction) {
    await this.#view?.goToFraction(fraction)
  }

  async goToCfi(cfi) {
    if (cfi) await this.#view?.goTo(cfi)
  }
  async goToTarget(target) { await this.#view?.goTo(target) }
  async getSpeechText() {
    return this.#view?.lastLocation?.range?.toString() || ''
  }
  async search(query) {
    if (!this.#view || !String(query || '').trim()) return []
    const results = []
    for await (const item of this.#view.search({query:String(query).trim()})) {
      if (item?.cfi) results.push({label:item.excerpt || 'Coincidencia',excerpt:item.excerpt || '',locator:{kind:'cfi',value:item.cfi}})
      for (const sub of item?.subitems || []) results.push({label:item.label || 'Coincidencia',excerpt:sub.excerpt || item.label || '',locator:{kind:'cfi',value:sub.cfi}})
      if (results.length >= 200) break
    }
    return results
  }
  getSelection() {
    for (const item of this.#view?.renderer?.getContents?.() || []) {
      const text = item.doc?.defaultView?.getSelection?.().toString().trim()
      if (text) return { text, locator:{kind:'cfi',value:this.#view.getCFI(item.index,item.doc.defaultView.getSelection().getRangeAt(0))} }
    }
    return null
  }
  addQuoteAnnotation(quote) { if (quote?.locator?.kind === 'cfi') this.#view?.addAnnotation?.({value:quote.locator.value,color:quote.color}) }
  removeQuoteAnnotation(quote) { if (quote?.locator?.kind === 'cfi') this.#view?.deleteAnnotation?.({value:quote.locator.value}) }
  async applyPreferences(preferences) {
    this.#preferences = normalizeReadingPreferences(preferences)
    this.#view?.renderer?.setAttribute('flow', this.#preferences.flow)
    this.#view?.renderer?.setAttribute('margin', String(this.#preferences.margin))
    this.#applyReaderStyles()
  }

  #applyReaderStyles() {
    // foliate-js permite inyectar CSS propio dentro de cada documento
    // renderizado vía renderer.setStyles(), para que la tipografía del
    // texto del libro use nuestra misma fuente base y las columnas
    // respiren igual que el resto de la UI.
    const css = readingCSS(this.#preferences)
    this.#view?.renderer?.setStyles?.(css)
  }

  close() {
    this.#detachGestures()
    for (const detach of this.#documentGestures) detach()
    this.#documentGestures = []
    this.#view?.close()
    this.#view?.remove()
    this.#view = null
    if (this.#container) { this.#container.innerHTML = ''; this.#container.classList.remove('foliate-reader') }
  }
}
