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

  async open(container, file, { onRelocate, onToggleChrome } = {}) {
    this.#format = await detectFormat(file)
    if (!isSupported(this.#format)) {
      throw new UnsupportedFormatError(
        `Formato no soportado: ${file?.name ?? 'archivo desconocido'}`
      )
    }

    if (this.#format.engine === ENGINE.PDF) {
      const { PdfReader } = await import('./pdf-reader.js')
      this.#reader = new PdfReader()
      const buffer = await file.arrayBuffer()
      await this.#reader.open(container, buffer, { onRelocate, onToggleChrome })
    } else {
      const { FoliateReader } = await import('./foliate-reader.js')
      this.#reader = new FoliateReader()
      await this.#reader.open(container, file, { onRelocate, onToggleChrome })
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

  close() {
    this.#reader?.close()
    this.#reader = null
  }
}
