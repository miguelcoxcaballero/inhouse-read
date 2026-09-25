// Persistencia de la biblioteca: libros recientes/abiertos, con su progreso
// de lectura, para poblar el home screen sin que el usuario tenga que
// volver a buscarlos. Usa IndexedDB (vía una capa mínima propia, sin
// dependencias) para poder guardar también la miniatura de portada como
// Blob, algo que localStorage no soporta bien.

const DB_NAME = 'inhouse-read'
const DB_VERSION = 1
const STORE = 'books'

/**
 * @typedef {Object} BookRecord
 * @property {string} id            - hash estable derivado del origen del libro
 * @property {string} title
 * @property {string} [author]
 * @property {string} format        - etiqueta legible: 'PDF' | 'EPUB' | 'MOBI' | ...
 * @property {'local'|'drive'} sourceType
 * @property {string} [driveFileId] - solo si sourceType === 'drive'
 * @property {Blob}   [cover]       - portada renderizada, si se pudo extraer
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
    }
    req.onsuccess = () => resolve(req.result)
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

/**
 * Deriva un id estable a partir del origen del libro, sin depender de que
 * el usuario elija exactamente el mismo File object dos veces (los File
 * picker devuelven objetos nuevos cada vez, pero con el mismo name+size
 * para el mismo archivo local).
 */
export function idForSource({ sourceType, driveFileId, name, size }) {
  if (sourceType === 'drive' && driveFileId) return `drive:${driveFileId}`
  return `local:${name}:${size}`
}

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
    const all = await wrap(store.getAll())
    return all
      .sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)
      .slice(0, limit)
  }

  async get(id) {
    const store = await this.#store('readonly')
    return wrap(store.get(id)) ?? null
  }

  /**
   * Inserta un libro nuevo o actualiza su `lastOpenedAt` (y cualquier campo
   * adicional que se pase) si ya existía. Es la operación central: se llama
   * cada vez que el usuario abre un libro, desde cualquier fuente.
   */
  async addOrTouch(partial) {
    const id = partial.id ?? idForSource(partial)
    const store = await this.#store('readwrite')
    const existing = await wrap(store.get(id))
    const now = Date.now()
    const record = {
      progressFraction: 0,
      ...existing,
      ...partial,
      id,
      addedAt: existing?.addedAt ?? now,
      lastOpenedAt: now
    }
    await wrap(store.put(record))
    return record
  }

  async updateProgress(id, progressFraction, locator) {
    const store = await this.#store('readwrite')
    const existing = await wrap(store.get(id))
    if (!existing) return null
    const record = { ...existing, progressFraction, locator, lastOpenedAt: Date.now() }
    await wrap(store.put(record))
    return record
  }

  /** Guarda/actualiza solo la portada, sin tocar lastOpenedAt. */
  async setCover(id, coverBlob) {
    const store = await this.#store('readwrite')
    const existing = await wrap(store.get(id))
    if (!existing) return null
    const record = { ...existing, cover: coverBlob }
    await wrap(store.put(record))
    return record
  }

  async remove(id) {
    const store = await this.#store('readwrite')
    await wrap(store.delete(id))
  }

  async clear() {
    const store = await this.#store('readwrite')
    await wrap(store.clear())
  }
}
