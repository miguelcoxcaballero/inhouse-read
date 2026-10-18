import { readDriveLibrarySnapshots, readDriveLibraryRevision, writeDriveLibrarySnapshot, uploadDriveCover, downloadDriveFile } from './drive-client.js'
import { spineCustomization } from './book-colors.js'
import { readBackupCheckpoint, saveBackupCheckpoint } from './cloud-backup-state.js'
import { SYNC_SETTINGS } from './cloud-settings.js'
import { cloudModule } from './cloud-native.js'

// Field-level last-write-wins registers, in a separate manifest per device
// (rust-ui/src/library_backup.rs). This class owns the platform callbacks and
// creates the Rust object once the module is in memory.
export class LibraryBackup {
  #native = null
  #loading = null
  #host
  #polling = null

  constructor(library, cloud, { storage = localStorage, onSettings = () => {}, onChange = () => {}, onStatus = () => {} } = {}) {
    this.#host = {
      library, cloud, storage, onSettings, onChange, onStatus, settings: SYNC_SETTINGS,
      withLock: (name, run) => globalThis.navigator?.locks?.request ? navigator.locks.request(name, run) : run(),
      randomUUID: () => crypto.randomUUID(),
      readDriveLibrarySnapshots: (...args) => readDriveLibrarySnapshots(...args),
      readDriveLibraryRevision: (...args) => readDriveLibraryRevision(...args),
      writeDriveLibrarySnapshot: (...args) => writeDriveLibrarySnapshot(...args),
      uploadDriveCover: (...args) => uploadDriveCover(...args),
      downloadDriveFile: (...args) => downloadDriveFile(...args),
      readBackupCheckpoint: (...args) => readBackupCheckpoint(...args),
      saveBackupCheckpoint: (...args) => saveBackupCheckpoint(...args),
      spineCustomization
    }
  }

  #ready() {
    if (this.#native) return Promise.resolve(this.#native)
    return this.#loading ||= cloudModule().then(ui => this.#native ||= new ui.RustLibraryBackup(this.#host))
      .finally(() => { this.#loading = null })
  }

  /** The running sync, if any (the app does not start another one meanwhile). */
  get task() { return this.#native?.task ?? null }
  get device() { return this.#native?.device }
  reset() { this.#native?.reset() }
  sync(accountId) { return this.#native ? this.#native.sync(accountId) : this.#ready().then(native => native.sync(accountId)) }
  poll(accountId) {
    return this.#polling ||= this.#ready().then(native => native.poll(accountId)).finally(() => { this.#polling = null })
  }
}
