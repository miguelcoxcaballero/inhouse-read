import { bookDataModule, withBookDataModule } from './book-data-native.js'
// Persistencia de la biblioteca: libros recientes/abiertos, con su progreso
// de lectura, para poblar el home screen sin que el usuario tenga que
// volver a buscarlos. Usa IndexedDB (vía una capa mínima propia, sin
// dependencias) para poder guardar también la miniatura de portada como
// Blob, algo que localStorage no soporta bien.

const DB_NAME = 'inhouse-read'
const DB_VERSION = 2
const STORE = 'books'
const REMOVED_STORE = 'removed-books'

/**
 * @typedef {Object} BookRecord
 * @property {string} id            - hash estable derivado del origen del libro
 * @property {string} title
 * @property {string} [author]
 * @property {string} format        - etiqueta legible: 'PDF' | 'EPUB' | 'MOBI' | ...
 * @property {'local'|'drive'} sourceType
 * @property {string} [driveFileId] - solo si sourceType === 'drive'
 * @property {Blob}   [content]     - bytes del propio libro, también descargado de Drive: permite
 *                                    reabrirlo sin volver a pedirle el archivo al
 *                                    usuario, sin depender de ninguna API de
 *                                    carpetas (funciona igual en Android que en
 *                                    escritorio)
 * @property {Blob}   [cover]       - portada renderizada, si se pudo extraer
 * @property {string} [contentRevision] - identity of these committed original bytes
 * @property {number} [wordCount] - complete extractable text across all PDF pages/spine sections
 * @property {number} [wordCountVersion] - counting convention, independent of reader layout
 * @property {boolean} [wordCountComplete] - partial/legacy counts never determine shelf geometry
 * @property {string} [wordCountContentRevision] - bytes to which the count belongs
 * @property {number} addedAt
 * @property {number} lastOpenedAt
 * @property {number} progressFraction - 0..1
 * @property {*}      [locator]     - página PDF o CFI/fraction de foliate, opaco para el store
 */

function openDB(dbName) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' })
        store.createIndex('lastOpenedAt', 'lastOpenedAt')
      }
      if (!db.objectStoreNames.contains(REMOVED_STORE)) {
        db.createObjectStore(REMOVED_STORE, { keyPath: 'id' })
      }
    }
    req.onsuccess = () => {
      // An older tab must not keep a future schema migration blocked.
      req.result.onversionchange = () => req.result.close()
      resolve(req.result)
    }
    req.onerror = () => reject(req.error)
  })
}

function tx(db, mode) {
  const t = db.transaction(STORE, mode)
  return t.objectStore(STORE)
}

function wrap(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function committed(transaction) {
  const completion = new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onabort = () => reject(transaction.error || new Error('No se pudo guardar la biblioteca.'))
    transaction.onerror = () => reject(transaction.error)
  })
  // A failed request can reject before its abort event. The caller still
  // receives that failure, without a second unhandled rejection here.
  completion.catch(() => {})
  return completion
}

export const idForSource = source => bookDataModule().library_id_for_source(source)
// A browser type primitive; comparison and traversal belong to Rust.
const dateInstance = value => value instanceof Date
export const libraryHost = { wrap, committed,
  recordComparator:next => { const native = bookDataModule(); return (record, index) => native.library_record_equal(next, record, index, dateInstance) },
  recentComparator:() => { const native = bookDataModule(); return (a, b) => native.library_recent_order(a, b) }
}

export const sameBookRecords = (previous, next) => bookDataModule().library_same_records(previous, next, libraryHost)
export const recentFirst = records => bookDataModule().library_recent_first(records, libraryHost)

export class LibraryStore {
  #dbPromise

  /**
   * @param {string} [dbName] - permite aislar bases de datos en tests; en
   * la app real siempre se usa el nombre por defecto.
   */
  constructor(dbName = DB_NAME) {
    this.#dbPromise = openDB(dbName)
  }

  /** Cierra la conexión subyacente. Solo hace falta en tests. */
  async close() {
    const db = await this.#dbPromise
    db.close()
  }

  async #store(mode) {
    const db = await this.#dbPromise
    return tx(db, mode)
  }

  /** Lista los libros ordenados por apertura más reciente primero. */
  async listRecents(limit = 50) {
    const store = await this.#store('readonly')
    const records = await wrap(store.getAll())
    return withBookDataModule(() => recentFirst(records).slice(0, limit))
  }

  async listAll() {
    return this.listRecents(Infinity)
  }

  // The first-frame gate sorts after its existing parallel module/bake wait.
  // Read bytes now so loading WASM never postpones the IndexedDB request.
  async listRaw() {
    const store = await this.#store('readonly')
    return wrap(store.getAll())
  }

  async listRemoved() {
    const db = await this.#dbPromise
    return wrap(db.transaction(REMOVED_STORE, 'readonly').objectStore(REMOVED_STORE).getAll())
  }

  async get(id) {
    return withBookDataModule(native => native.library_get(this.#dbPromise, libraryHost, id))
  }
  async isRemovedFromShelf(source) {
    return withBookDataModule(native => native.library_is_removed(this.#dbPromise, libraryHost, source))
  }
  async addOrTouch(partial, options = {}) {
    return withBookDataModule(native => native.library_add(this.#dbPromise, libraryHost, partial, options))
  }
  async updateProgress(id, progressFraction, locator) {
    return withBookDataModule(native => native.library_update_progress(this.#dbPromise, libraryHost, id, progressFraction, locator))
  }
  async removeFromShelf(bookOrId, options = {}) {
    return withBookDataModule(native => native.library_remove_from_shelf(this.#dbPromise, libraryHost, bookOrId, options))
  }
  async rememberRemovedDriveLink(book, driveFileId, cloudAccountId) {
    return withBookDataModule(native => native.library_remember_removed(this.#dbPromise, libraryHost, book, driveFileId, cloudAccountId))
  }
  async patch(id, fields, options = {}) {
    return withBookDataModule(native => native.library_patch(this.#dbPromise, libraryHost, id, fields, options))
  }
  async setCover(id, coverBlob) {
    return withBookDataModule(native => native.library_set_cover(this.#dbPromise, libraryHost, id, coverBlob))
  }

  async remove(id) {
    const store = await this.#store('readwrite')
    await wrap(store.delete(id))
  }

  async clear() {
    const db = await this.#dbPromise
    const transaction = db.transaction([STORE, REMOVED_STORE], 'readwrite')
    const completion = committed(transaction)
    transaction.objectStore(STORE).clear()
    transaction.objectStore(REMOVED_STORE).clear()
    await completion
  }
}
