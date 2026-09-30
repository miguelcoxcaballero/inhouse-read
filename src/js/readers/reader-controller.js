// Punto único de entrada para abrir un libro: detecta el formato y delega
// en PdfReader o FoliateReader, exponiendo la misma interfaz mínima hacia
// el resto de la app (open/next/prev/close + evento de progreso), para que
// la UI del visor no necesite saber qué motor hay debajo.

import { detectFormat, ENGINE, isSupported } from '../format-detect.js'

export class UnsupportedFormatError extends Error {}

export class ReaderController {
  #engine
  #reader
  #format
  #location = { fraction:0, locator:null }

  async open(container, file, { onRelocate, onToggleChrome, onUserNavigation, onFollowLink } = {}) {
    this.close()
    this.#format = await detectFormat(file)
    if (!isSupported(this.#format)) {
      throw new UnsupportedFormatError(
        `Formato no soportado: ${file?.name ?? 'archivo desconocido'}`
      )
    }

    this.#engine = this.#format.engine
    const relocate = data => {
      this.#location = {
        fraction: Math.min(1, Math.max(0, Number(data.fraction) || 0)),
        locator: data.cfi ? { kind:'cfi', value:data.cfi }
          : this.#engine === ENGINE.PDF ? { kind:'pdf-page', value:(data.index || 0) + 1 } : null,
        section:data.section || '', page:data.page || ''
      }
      onRelocate?.(data)
    }
    if (this.#format.engine === ENGINE.PDF) {
      const { PdfReader } = await import('./pdf-reader.js')
      this.#reader = new PdfReader()
      const buffer = await file.arrayBuffer()
      await this.#reader.open(container, buffer, { onRelocate:relocate, onToggleChrome, onUserNavigation })
    } else {
      const { FoliateReader } = await import('./foliate-reader.js')
      this.#reader = new FoliateReader()
      await this.#reader.open(container, file, { onRelocate:relocate, onToggleChrome, onUserNavigation, onFollowLink })
    }

    this.#engine = this.#format.engine
    return this.#format
  }

  get format() {
    return this.#format
  }

  /** Metadatos del libro cuando el motor los expone (foliate); {} en PDF. */
  get metadata() {
    return this.#reader?.metadata ?? {}
  }
  get location() { return this.#location }
  get language() { const lang = this.metadata.language; return (Array.isArray(lang) ? lang[0] : lang) || navigator.language }
  get toc() { return this.#reader?.toc ?? [] }
  async goToTarget(target) { await this.#reader?.goToTarget?.(target) }
  async applyPreferences(preferences) { await this.#reader?.applyPreferences?.(preferences) }
  async getSpeechText() { return await this.#reader?.getSpeechText?.() || '' }
  async getPageSnapshot() {
    const reader = this.#reader
    const snapshot = await reader?.getPageSnapshot?.()
    // A selection can replace this shared reader while an ebook layout awaits
    // its fonts. Never give the newly selected book a previous book's bitmap.
    if (!snapshot || reader !== this.#reader) return null
    return { ...snapshot, location:{ ...this.#location, ...(snapshot.location || {}) } }
  }
  async search(query) { return await this.#reader?.search?.(query) || [] }
  getSelection() { return this.#reader?.getSelection?.() || null }
  addQuoteAnnotation(quote) { this.#reader?.addQuoteAnnotation?.(quote) }
  removeQuoteAnnotation(quote) { this.#reader?.removeQuoteAnnotation?.(quote) }

  /** Portada como Blob: miniatura de la página 1 en PDF, embebida en EPUB/MOBI. */
  async getCoverBlob() {
    return (await this.#reader?.getCoverBlob?.()) ?? null
  }

  /**
   * Número de páginas reales, solo cuando el formato lo tiene de verdad
   * (PDF). EPUB/MOBI son texto reflowable sin un "número de página" fijo
   * independiente del tamaño de pantalla/fuente, así que devuelve null en
   * vez de inventar un número — el grosor del lomo en la estantería cae
   * entonces a `sizeBytes` (ver bookshelf-layout.js, sqrtScale).
   */
  get pageCount() {
    return this.#engine === ENGINE.PDF ? (this.#reader?.pageCount ?? null) : null
  }

  async next() {
    await this.#reader?.next()
  }

  async prev() {
    await this.#reader?.prev()
  }

  async goToFraction(fraction) {
    if (this.#engine === ENGINE.FOLIATE) await this.#reader?.goToFraction(fraction)
    else if (this.#engine === ENGINE.PDF) {
      const pageCount = this.#reader?.pageCount ?? 1
      await this.#reader?.goToPage(Math.round(fraction * (pageCount - 1)) + 1)
    }
  }

  async goToLocator(locator, fallbackFraction = 0) {
    if (locator?.kind === 'cfi' && this.#engine === ENGINE.FOLIATE) {
      try { await this.#reader?.goToCfi(locator.value); return } catch { /* changed edition */ }
    }
    if (locator?.kind === 'pdf-page' && this.#engine === ENGINE.PDF) {
      await this.#reader?.goToPage(locator.value)
      return
    }
    await this.goToFraction(fallbackFraction)
  }

  close() {
    this.#reader?.close()
    this.#reader = null
    this.#location = { fraction:0, locator:null }
  }
}
