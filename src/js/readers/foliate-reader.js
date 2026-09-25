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
import { attachSwipeNavigation } from '../gestures.js'

export class FoliateReader {
  #view
  #container
  #onRelocate = () => {}
  #detachGestures = () => {}

  async open(container, file, { onRelocate, onToggleChrome } = {}) {
    this.#container = container
    this.#onRelocate = onRelocate ?? (() => {})

    container.innerHTML = ''
    container.classList.add('foliate-reader')

    this.#view = document.createElement('foliate-view')
    this.#view.classList.add('foliate-view-el')
    container.append(this.#view)

    // foliate-js es deliberadamente de bajo nivel y no trae gestos táctiles
    // propios (ver HANDOFF-FORMATOS.md): reusamos el mismo detector de
    // swipe/tap que el lector de PDF para que la sensación táctil sea
    // idéntica entre formatos.
    this.#detachGestures = attachSwipeNavigation(container, {
      onNext: () => this.next(),
      onPrev: () => this.prev(),
      onToggleChrome
    })

    this.#view.addEventListener('relocate', e => {
      this.#onRelocate({
        index: e.detail.index,
        fraction: e.detail.fraction ?? 0,
        cfi: e.detail.cfi
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

  #applyReaderStyles() {
    // foliate-js permite inyectar CSS propio dentro de cada documento
    // renderizado vía renderer.setStyles(), para que la tipografía del
    // texto del libro use nuestra misma fuente base y las columnas
    // respiren igual que el resto de la UI.
    const css = `
      @namespace epub "http://www.idpf.org/2007/ops";
      html, body { color-scheme: light dark; }
      body {
        font-family: var(--f-body, 'DM Sans', sans-serif);
        line-height: 1.6;
      }
    `
    this.#view?.renderer?.setStyles?.(css)
  }

  close() {
    this.#detachGestures()
    this.#view?.close()
    this.#view?.remove()
    this.#view = null
    if (this.#container) this.#container.innerHTML = ''
  }
}
