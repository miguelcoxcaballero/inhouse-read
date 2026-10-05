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

function sourceMatches(removal, source) {
  if (removal.id === source.id) return true
  if (removal.cloudAccountId && source.cloudAccountId && removal.cloudAccountId !== source.cloudAccountId) return false
  if (removal.driveFileId && source.driveFileId) return removal.driveFileId === source.driveFileId
  return Boolean(removal.name && source.name && removal.name === source.name &&
    Number(removal.size) === Number(source.size))
}

function removalIdentity(source, previous = {}) {
  // Deliberately retain no book bytes, image, text, reading state or handle.
  return {
    id: source.id,
    name: source.name || previous.name || '',
    size: Number(source.size ?? previous.size) || 0,
    ...(source.driveFileId || previous.driveFileId
      ? { driveFileId: source.driveFileId || previous.driveFileId } : {}),
    ...(source.cloudAccountId || previous.cloudAccountId
      ? { cloudAccountId: source.cloudAccountId || previous.cloudAccountId } : {}),
    removedAt: previous.removedAt || Date.now()
  }
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

const isBlob = value => /^\[object (Blob|File)\]$/.test(Object.prototype.toString.call(value))

function sameValue(a, b) {
  if (Object.is(a, b)) return true
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false
  // IndexedDB returns fresh Blob objects on every read; type, size and
  // modification time identify the stored file.
  if (isBlob(a) || isBlob(b)) return isBlob(a) && isBlob(b) && a.type === b.type && a.size === b.size && a.lastModified === b.lastModified
  if (a instanceof Date || b instanceof Date) return a instanceof Date && b instanceof Date && a.getTime() === b.getTime()
  const plain = Array.isArray(a) ? Array.isArray(b) : Object.getPrototypeOf(a) === Object.prototype && Object.getPrototypeOf(b) === Object.prototype
  if (!plain) return false
  const keys = Object.keys(a)
  return keys.length === Object.keys(b).length && keys.every(key => key in b && sameValue(a[key], b[key]))
}

/**
 * True when two record lists describe the same shelf. A background sync
 * reports a change even when every record came back identical, and drawing
 * the 3D shelf again for it costs a full layout and repaint. Anything this
 * cannot prove equal (any other object type included) counts as different.
 */
export function sameBookRecords(previous, next) {
  return previous.length === next.length && previous.every((record, index) => sameValue(record, next[index]))
}

/** The order listAll() returns: most recently opened first. */
export function recentFirst(records) {
  return records.sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)
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
    return recentFirst(await wrap(store.getAll())).slice(0, limit)
  }

  async listAll() {
    return this.listRecents(Infinity)
  }

  async get(id) {
    const store = await this.#store('readonly')
    return (await wrap(store.get(id))) ?? null
  }

  /** Keeps automatic Drive discovery from putting a removed book back. */
  async isRemovedFromShelf(source) {
    if (typeof source === 'string') source = { id: source }
    if (!source) return false
    const db = await this.#dbPromise
    const removals = await wrap(db.transaction(REMOVED_STORE, 'readonly').objectStore(REMOVED_STORE).getAll())
    return removals.some(removal => sourceMatches(removal, source))
  }

  /**
   * Inserta un libro nuevo o actualiza su `lastOpenedAt` (y cualquier campo
   * adicional que se pase) si ya existía. Es la operación central: se llama
   * cada vez que el usuario abre un libro, desde cualquier fuente.
   */
  async addOrTouch(partial, { restoreRemoved = false } = {}) {
    const id = partial.id ?? idForSource(partial)
    const db = await this.#dbPromise
    const transaction = db.transaction([STORE, REMOVED_STORE], 'readwrite')
    const completion = committed(transaction)
    const store = transaction.objectStore(STORE)
    const removedStore = transaction.objectStore(REMOVED_STORE)
    const removals = await wrap(removedStore.getAll())
    const matching = removals.filter(removal => sourceMatches(removal, { ...partial, id }))
    if (matching.length && !restoreRemoved) {
      await completion
      return null
    }
    if (restoreRemoved) for (const removal of matching) removedStore.delete(removal.id)
    const existing = await wrap(store.get(id))
    const now = Date.now()
    // Missing optional fields on a reopen must not erase a saved Drive link,
    // original bytes or progress. Explicit null still clears a field.
    const defined = Object.fromEntries(Object.entries(partial).filter(([, value]) => value !== undefined))
    const record = {
      progressFraction: 0,
      ...existing,
      ...defined,
      id,
      addedAt: existing?.addedAt ?? now,
      lastOpenedAt: now
    }
    await wrap(store.put(record))
    await completion
    return record
  }

  async updateProgress(id, progressFraction, locator) {
    const store = await this.#store('readwrite')
    const completion = committed(store.transaction)
    const existing = await wrap(store.get(id))
    if (!existing) return null
    const now = Date.now()
    const record = {
      ...existing, progressFraction, locator,
      progressUpdatedAt: now, progressDirty: true, lastOpenedAt: now
    }
    await wrap(store.put(record))
    await completion
    return record
  }

  /**
   * Removes the app's record, cached file and cover, leaving the source file
   * in Drive / the user's device untouched. A tiny identity marker prevents
   * subsequent background syncs from silently importing it again.
   */
  async removeFromShelf(bookOrId) {
    const id = typeof bookOrId === 'string' ? bookOrId : bookOrId?.id
    if (!id) return null
    const db = await this.#dbPromise
    const transaction = db.transaction([STORE, REMOVED_STORE], 'readwrite')
    const completion = committed(transaction)
    const store = transaction.objectStore(STORE)
    const removedStore = transaction.objectStore(REMOVED_STORE)
    const record = await wrap(store.get(id))
    const previous = await wrap(removedStore.get(id))
    const source = { ...(typeof bookOrId === 'object' ? bookOrId : {}), ...record, id }
    const removal = removalIdentity(source, previous)
    removedStore.put(removal)
    store.delete(id)
    await completion
    return removal
  }

  /** Adds a Drive identity discovered by an upload that completed too late. */
  async rememberRemovedDriveLink(book, driveFileId, cloudAccountId) {
    const db = await this.#dbPromise
    const transaction = db.transaction(REMOVED_STORE, 'readwrite')
    const completion = committed(transaction)
    const store = transaction.objectStore(REMOVED_STORE)
    const previous = await wrap(store.get(book.id))
    // An explicit reimport may have already restored this book; do not
    // re-hide that import when an old network request finally completes.
    if (previous) store.put(removalIdentity({ ...book, driveFileId, cloudAccountId }, previous))
    await completion
  }

  /** Actualiza metadatos de Drive sin cambiar el orden de la estantería. */
  async patch(id, fields, { ifCurrent } = {}) {
    const store = await this.#store('readwrite')
    const completion = committed(store.transaction)
    const existing = await wrap(store.get(id))
    if (!existing) return null
    if (ifCurrent && !ifCurrent(existing)) { await completion; return null }
    const record = { ...existing, ...fields, id }
    await wrap(store.put(record))
    await completion
    return record
  }

  /** Guarda/actualiza solo la portada, sin tocar lastOpenedAt. */
  async setCover(id, coverBlob) {
    const store = await this.#store('readwrite')
    const completion = committed(store.transaction)
    const existing = await wrap(store.get(id))
    if (!existing) return null
    const record = { ...existing, cover: coverBlob, coverUpdatedAt: Date.now() }
    await wrap(store.put(record))
    await completion
    return record
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
