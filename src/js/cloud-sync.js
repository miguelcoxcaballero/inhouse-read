import { spineCustomization } from './book-colors.js'
import {
  getDriveProfile, listAllDriveBooks, uploadDriveFile, downloadDriveFile,
  readDriveProgress, writeDriveProgress
} from './drive-client.js'
import { normalizeBookTitle } from './book-title.js'
import { cleanPlaces, cleanQuotes } from './readers/reading-state.js'
import { driveBookLength, wordCountFromDrive } from './book-length-drive.js'
import { clearBookLength, newContentRevision } from './book-length-queue.js'
import { cloudModule } from './cloud-native.js'

/** Reconciles IndexedDB with the user's "inhouse read" Drive folder. The work is
 * rust-ui/src/cloud_sync.rs; this class owns the host callbacks and creates
 * the Rust object once the module is in memory (never before the first shelf frame). */
export class CloudSync {
  #library
  #host
  #profile = null
  #native = null
  #loading = null
  #epoch = 0

  constructor(library, { onStatus = () => {}, onChange = () => {} } = {}) {
    this.#library = library
    this.#host = {
      library, onStatus, onChange,
      getDriveProfile: (...args) => getDriveProfile(...args),
      listAllDriveBooks: (...args) => listAllDriveBooks(...args),
      uploadDriveFile: (...args) => uploadDriveFile(...args),
      downloadDriveFile: (...args) => downloadDriveFile(...args),
      readDriveProgress: (...args) => readDriveProgress(...args),
      writeDriveProgress: (...args) => writeDriveProgress(...args),
      spineCustomization, normalizeBookTitle, cleanPlaces, cleanQuotes, driveBookLength, wordCountFromDrive,
      clearBookLength, newContentRevision
    }
  }

  #ready() {
    if (this.#native) return Promise.resolve(this.#native)
    return this.#loading ||= cloudModule().then(ui => this.#native ||= new ui.RustCloudSync(this.#host, this.#profile))
      .finally(() => { this.#loading = null })
  }

  setProfile(profile) { this.#profile = profile; this.#native?.setProfile(profile) }

  #call(name, ...args) {
    return this.#native ? this.#native[name](...args) : this.#ready().then(native => native[name](...args))
  }

  /** Forget the app's copy, without deleting or trashing the Drive file. */
  removeFromShelf(book, options) {
    if (this.#native) return this.#native.removeFromShelf(book, options)
    // Nothing of this class is in flight before its Rust object exists, so the book needs no
    // bookkeeping: removing it must not wait for a module download (the trash gesture is visible).
    if (!this.#loading) return (async () => book?.id ? this.#library.removeFromShelf(book, options) : null)()
    return this.#ready().then(native => native.removeFromShelf(book, options))
  }

  reset() { this.#epoch++; this.#profile = null; this.#native?.reset() }

  uploadBook(book) { return this.#call('uploadBook', book) }

  downloadForOffline(book) { return this.#call('downloadForOffline', book) }

  scheduleProgress(bookId) {
    if (this.#native) return this.#native.scheduleProgress(bookId)
    if (!bookId) return
    const epoch = this.#epoch
    this.#ready().then(native => { if (epoch === this.#epoch) native.scheduleProgress(bookId) },
      error => this.#host.onStatus(`Progreso pendiente: ${error.message}`))
  }

  flushProgress(bookId) { return this.#call('flushProgress', bookId) }

  syncBookProgress(bookOrId) { return this.#call('syncBookProgress', bookOrId) }

  sync() { return this.#call('sync') }
}
