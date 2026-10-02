import { spineCustomization } from './book-colors.js'
import {
  getDriveProfile, listAllDriveBooks, uploadDriveFile, downloadDriveFile,
  readDriveProgress, writeDriveProgress
} from './drive-client.js'
import { normalizeBookTitle } from './book-title.js'
import { cleanPlaces, cleanQuotes } from './readers/reading-state.js'

const EXTENSIONS = /\.(pdf|epub|mobi|azw|azw3|fb2|cbz)$/i

/** Reconciles IndexedDB with the user's "inhouse read" Drive folder. */
export class CloudSync {
  #library
  #onStatus
  #onChange
  #profile = null
  #syncTask = null
  #uploads = new Map()
  #downloads = new Map()
  #progressTimers = new Map()
  #progressSyncs = new Map()
  #generation = 0
  #bookGenerations = new Map()

  constructor(library, { onStatus = () => {}, onChange = () => {} } = {}) {
    this.#library = library
    this.#onStatus = onStatus
    this.#onChange = onChange
  }

  setProfile(profile) { this.#profile = profile }

  #bookGeneration(id) { return this.#bookGenerations.get(id) || 0 }

  #isCurrent(id, bookGeneration, generation) {
    return generation === this.#generation && bookGeneration === this.#bookGeneration(id)
  }

  /** Forget the app's copy, without deleting or trashing the Drive file. */
  async removeFromShelf(book) {
    if (!book?.id) return null
    this.#bookGenerations.set(book.id, this.#bookGeneration(book.id) + 1)
    clearTimeout(this.#progressTimers.get(book.id))
    this.#progressTimers.delete(book.id)
    this.#uploads.delete(book.id)
    this.#downloads.delete(book.id)
    this.#progressSyncs.delete(book.id)
    return this.#library.removeFromShelf(book)
  }

  reset() {
    this.#generation += 1
    this.#profile = null
    for (const timer of this.#progressTimers.values()) clearTimeout(timer)
    this.#progressTimers.clear()
  }

  async #account() {
    if (!this.#profile) this.#profile = await getDriveProfile()
    if (!this.#profile?.id) throw new Error('No se pudo identificar la cuenta de Google.')
    return this.#profile.id
  }

  async uploadBook(book) {
    if (this.#uploads.has(book.id)) return this.#uploads.get(book.id)
    const generation = this.#generation
    const bookGeneration = this.#bookGeneration(book.id)
    const task = (async () => {
      const accountId = await this.#account()
      if (!this.#isCurrent(book.id, bookGeneration, generation) || await this.#library.isRemovedFromShelf(book)) return null
      const record = await this.#library.get(book.id) || book
      if (!this.#isCurrent(book.id, bookGeneration, generation)) return null
      if (record.cloudAccountId && record.cloudAccountId !== accountId) {
        throw new Error('Este libro está vinculado a otra cuenta de Google.')
      }
      if (record.driveFileId) return record
      if (!record.content) throw new Error('Falta la copia local del libro. Vuelve a importarlo.')
      const file = new File([record.content], record.name || record.title || 'libro', {
        type: record.mimeType || record.content.type || 'application/octet-stream'
      })
      const uploaded = await uploadDriveFile(file)
      if (!this.#isCurrent(book.id, bookGeneration, generation)) {
        await this.#library.rememberRemovedDriveLink(record, uploaded.id, accountId)
        return null
      }
      const updated = await this.#library.patch(record.id, {
        driveFileId: uploaded.id, driveFileName: uploaded.name,
        cloudAccountId: accountId, sourceType: 'local'
      })
      if (updated) this.#onChange()
      return updated
    })()
    this.#uploads.set(book.id, task)
    try { return await task } finally {
      if (this.#uploads.get(book.id) === task) this.#uploads.delete(book.id)
    }
  }

  async downloadForOffline(book) {
    if (this.#downloads.has(book.id)) return this.#downloads.get(book.id)
    const generation = this.#generation
    const bookGeneration = this.#bookGeneration(book.id)
    const task = (async () => {
      if (await this.#library.isRemovedFromShelf(book)) return null
      const record = await this.#library.get(book.id) || book
      if (!this.#isCurrent(book.id, bookGeneration, generation)) return null
      if (record.content) return new File([record.content], record.name || record.title || 'libro', { type: record.mimeType || record.content.type })
      const accountId = await this.#account()
      if (!this.#isCurrent(book.id, bookGeneration, generation)) return null
      if (record.cloudAccountId && record.cloudAccountId !== accountId) {
        throw new Error('Conecta la cuenta de Google de este libro.')
      }
      const file = await downloadDriveFile(record.driveFileId, { name: record.name || record.title, mimeType: record.mimeType })
      if (this.#isCurrent(book.id, bookGeneration, generation)) {
        await this.#library.patch(record.id, { content: new Blob([file], { type: file.type }), cloudAccountId: accountId })
        this.#onChange()
      } else return null
      return file
    })()
    this.#downloads.set(book.id, task)
    try { return await task } finally {
      if (this.#downloads.get(book.id) === task) this.#downloads.delete(book.id)
    }
  }

  scheduleProgress(bookId) {
    if (!bookId) return
    clearTimeout(this.#progressTimers.get(bookId))
    this.#progressTimers.set(bookId, setTimeout(() => {
      this.#progressTimers.delete(bookId)
      this.syncBookProgress(bookId).catch(error => this.#onStatus(`Progreso pendiente: ${error.message}`))
    }, 1800))
  }

  flushProgress(bookId) {
    clearTimeout(this.#progressTimers.get(bookId))
    this.#progressTimers.delete(bookId)
    return this.syncBookProgress(bookId)
  }

  async syncBookProgress(bookOrId) {
    const id = typeof bookOrId === 'string' ? bookOrId : bookOrId?.id
    if (!id) return
    const previous = this.#progressSyncs.get(id)
    const generation = this.#generation
    const bookGeneration = this.#bookGeneration(id)
    const task = (previous || Promise.resolve()).catch(() => {}).then(() => this.#syncBookProgressOnce(id, generation, bookGeneration))
    this.#progressSyncs.set(id, task)
    try { return await task } finally {
      if (this.#progressSyncs.get(id) === task) this.#progressSyncs.delete(id)
    }
  }

  async #syncBookProgressOnce(id, generation, bookGeneration) {
    if (!this.#isCurrent(id, bookGeneration, generation)) return
    const record = await this.#library.get(id)
    if (!record?.driveFileId) return
    const accountId = await this.#account()
    if (!this.#isCurrent(id, bookGeneration, generation)) return
    if (record.cloudAccountId && record.cloudAccountId !== accountId) return
    const remote = await readDriveProgress(record.driveFileId)
    if (!this.#isCurrent(id, bookGeneration, generation)) return
    const localUpdatedAt = Number(record.progressUpdatedAt) || 0
    const remoteUpdatedAt = Number(remote?.updatedAt) || 0
    const localHasProgress = record.progressDirty || record.progressFraction > 0 || record.locator != null

    // Equal millisecond timestamps are possible when two reading updates land
    // in the same frame. Keep a dirty local locator on a tie; otherwise a
    // stale remote value can erase the newest page the reader just saved.
    if (remote && (!localHasProgress || remoteUpdatedAt > localUpdatedAt ||
      (remoteUpdatedAt === localUpdatedAt && !record.progressDirty))) {
      await this.#library.patch(record.id, {
        progressFraction: remote.fraction, locator: remote.locator,
        ...spineCustomization(remote.appearance),
        ...(Array.isArray(remote.readingHistory) ? { readingHistory:cleanPlaces(remote.readingHistory) } : {}),
        ...(Array.isArray(remote.bookmarks) ? { bookmarks:cleanPlaces(remote.bookmarks,100) } : {}),
        ...(Array.isArray(remote.quotes) ? { quotes:cleanQuotes(remote.quotes) } : {}),
        progressUpdatedAt: remoteUpdatedAt, progressDirty: false,
        progressStateFileId: remote.stateFileId
      })
      this.#onChange()
      return
    }
    if (!localHasProgress) return
    const snapshot = {
      fraction: record.progressFraction, locator: record.locator,
      appearance:spineCustomization(record),
      readingHistory:cleanPlaces(record.readingHistory), bookmarks:cleanPlaces(record.bookmarks,100),
      quotes:cleanQuotes(record.quotes),
      updatedAt: localUpdatedAt || Date.now()
    }
    const uploaded = await writeDriveProgress(record.driveFileId, snapshot,
      remote?.stateFileId || record.progressStateFileId)
    if (!this.#isCurrent(id, bookGeneration, generation)) return
    const latest = await this.#library.get(record.id)
    if (!latest || !this.#isCurrent(id, bookGeneration, generation)) return
    const unchanged = (Number(latest.progressUpdatedAt) || 0) === localUpdatedAt &&
      Number(latest.progressFraction) === Number(snapshot.fraction) &&
      JSON.stringify(latest.locator ?? null) === JSON.stringify(snapshot.locator ?? null) &&
      JSON.stringify(cleanPlaces(latest.readingHistory)) === JSON.stringify(snapshot.readingHistory) &&
      JSON.stringify(cleanPlaces(latest.bookmarks,100)) === JSON.stringify(snapshot.bookmarks) &&
      JSON.stringify(cleanQuotes(latest.quotes)) === JSON.stringify(snapshot.quotes) &&
      JSON.stringify(spineCustomization(latest)) === JSON.stringify(snapshot.appearance)
    await this.#library.patch(record.id, {
      ...(unchanged ? { progressDirty: false, progressUpdatedAt: snapshot.updatedAt } : {}),
      progressStateFileId: uploaded.id
    })
  }

  sync() {
    if (this.#syncTask) return this.#syncTask
    this.#syncTask = this.#doSync().finally(() => { this.#syncTask = null })
    return this.#syncTask
  }

  async #doSync() {
    const generation = this.#generation
    const accountId = await this.#account()
    this.#onStatus('Buscando libros en Google Drive…', true)
    const remoteBooks = await listAllDriveBooks()
    const localBooks = await this.#library.listAll()
    const byDriveId = new Map(localBooks.filter(book =>
      book.driveFileId && (!book.cloudAccountId || book.cloudAccountId === accountId)
    ).map(book => [book.driveFileId, book]))
    const usedLocalIds = new Set()
    const linked = []

    for (const remote of remoteBooks) {
      if (generation !== this.#generation) return
      const remoteSource = { driveFileId:remote.id, cloudAccountId:accountId, name:remote.name, size:Number(remote.size) || 0 }
      if (await this.#library.isRemovedFromShelf(remoteSource)) continue
      let record = byDriveId.get(remote.id)
      if (!record) {
        const matches = localBooks.filter(book =>
          !book.driveFileId && !usedLocalIds.has(book.id) &&
          (!book.cloudAccountId || book.cloudAccountId === accountId) &&
          book.name === remote.name && Number(book.size) === Number(remote.size)
        )
        if (matches.length === 1) {
          record = await this.#library.patch(matches[0].id, {
            driveFileId: remote.id, driveFileName: remote.name, cloudAccountId: accountId
          })
          if (!record) continue
          usedLocalIds.add(record.id)
        } else {
          record = await this.#library.addOrTouch({
            sourceType: 'drive', driveFileId: remote.id, driveFileName: remote.name,
            cloudAccountId: accountId, name: remote.name,
            title: normalizeBookTitle(remote.name), mimeType: remote.mimeType,
            size: Number(remote.size) || 0, sizeBytes: Number(remote.size) || 0,
            format: remote.name.match(EXTENSIONS)?.[1].toUpperCase() || ''
          })
          if (!record) continue
        }
        this.#onChange()
      } else if (!record.cloudAccountId) {
        record = await this.#library.patch(record.id, { cloudAccountId: accountId })
      }
      if (record) linked.push(record)
    }

    const remoteIds = new Set(remoteBooks.map(book => book.id))
    const pending = localBooks.filter(book =>
      book.sourceType === 'local' && book.content && !book.driveFileId &&
      !usedLocalIds.has(book.id) &&
      (!book.cloudAccountId || book.cloudAccountId === accountId)
    )
    let uploaded = 0
    const errors = []
    for (const book of pending) {
      if (generation !== this.#generation) return
      this.#onStatus(`Subiendo ${uploaded + 1} de ${pending.length} libros…`, true)
      try {
        const record = await this.uploadBook(book)
        if (record?.driveFileId) {
          linked.push(record)
          remoteIds.add(record.driveFileId)
          uploaded += 1
        }
      } catch (error) {
        errors.push(`${book.title || book.name}: ${error.message}`)
      }
    }

    for (const record of linked) {
      if (generation !== this.#generation) return
      try { await this.syncBookProgress(record.id) }
      catch (error) { errors.push(`${record.title || record.name}: ${error.message}`) }
    }
    this.#onStatus(errors.length
      ? `Sincronización incompleta: ${errors[0]}`
      : `Sincronizado · ${remoteIds.size} ${remoteIds.size === 1 ? 'libro' : 'libros'}`)
    this.#onChange()
    return { books: remoteIds.size, uploaded, errors }
  }
}
