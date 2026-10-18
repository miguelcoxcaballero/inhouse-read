// Frozen copy of src/js/library-backup.js before its port to Rust (rust-ui/src/library_backup.rs). Used only by the differential tests. Explicit 1.7.290 contracts: shared appearance identity and changed-setting notifications; room encoding has its own native tests.
import { readDriveLibrarySnapshots, writeDriveLibrarySnapshot, uploadDriveCover, downloadDriveFile } from '../../../src/js/drive-client.js'
import { spineCustomization } from '../../../src/js/book-colors.js'
import { readBackupCheckpoint, saveBackupCheckpoint } from '../../../src/js/cloud-backup-state.js'

import { SYNC_SETTINGS } from '../../../src/js/cloud-settings.js'
const META = ['name','title','author','format','mimeType','size','sizeBytes','pageCount','shelfOrder','addedAt','lastOpenedAt','shelfVisualId',
  'coverAppearance','coverAppearanceKey','coverUpdatedAt','driveContentChecksum',
  'progressFraction','locator','progressUpdatedAt','readingHistory','bookmarks','quotes']
const DEVICE_KEY = 'inhouse-read-backup-device'
const CHANGES_KEY = 'inhouse-read-backup-settings-changes'
const json = value => JSON.stringify(value ?? null)
const parse = (storage, key, fallback) => { try { return JSON.parse(storage.getItem(key)) ?? fallback } catch { return fallback } }
const newer = (a, b) => !b || a.at > b.at || a.at === b.at && a.device > b.device


function metadata(book) {
  const result = { ...spineCustomization(book) }
  for (const key of META) if (book[key] !== undefined) result[key] = book[key]
  if (typeof result.shelfVisualId !== 'string' || !result.shelfVisualId) { delete result.shelfVisualId; if (typeof book.id === 'string' && book.id) result.shelfVisualId = book.id }
  return result
}

// Field-level last-write-wins registers, in a separate manifest per device.
// An empty installation contributes no deletions. Explicit removals are retained
// as tombstones, and edits to different books/fields survive concurrent syncs.
export class LibraryBackup {
  constructor(library, cloud, { storage = localStorage, onSettings = () => {}, onChange = () => {}, onStatus = () => {} } = {}) {
    this.library = library; this.cloud = cloud; this.storage = storage
    this.onSettings = onSettings; this.onStatus = onStatus; this.onChange = onChange
    this.generation = 0; this.task = null
    this.device = storage.getItem(DEVICE_KEY) || crypto.randomUUID()
    storage.setItem(DEVICE_KEY, this.device)
  }
  reset() { this.generation++; this.task = null }
  sync(accountId) {
    if (this.task) {
      const generation = this.generation
      return this.task.then(() => generation === this.generation ? this.sync(accountId) : undefined)
    }
    const generation = this.generation
    const guard = () => {
      if (generation !== this.generation) throw new Error('La cuenta de Google ha cambiado.')
    }
    const run = () => { guard(); return this.run(accountId, guard) }
    const task = (globalThis.navigator?.locks?.request
      ? navigator.locks.request(`inhouse-read-drive:${accountId}`, run) : run())
      .finally(() => { if (this.task === task) this.task = null })
    this.task = task
    return task
  }
  async run(accountId, guard) {
    const active = () => { try { guard(); return true } catch { return false } }
    if (!accountId) throw new Error('Conecta tu cuenta de Google para guardar la biblioteca.')
    const key = `${this.device}:${accountId}`
    const baseline = await readBackupCheckpoint(key); guard()
    this.onStatus('Sincronizando biblioteca y estantería…', true)
    // Failure here must abort: never publish an empty replacement after a
    // failed read. Per-device manifests also preserve the originals in Drive.
    const snapshots = await readDriveLibrarySnapshots(); guard()
    const merged = { books:{}, settings:{} }
    const mergeFields = (target, source) => {
      for (const [field, entry] of Object.entries(source || {})) {
        if (['__proto__','constructor','prototype'].includes(field)) continue
        if (!entry || !Number.isFinite(entry.at) || typeof entry.device !== 'string' || !Object.hasOwn(entry, 'value')) continue
        if (newer(entry, target[field])) target[field] = entry
      }
    }
    for (const snapshot of snapshots) {
      for (const book of snapshot.books) {
        if (typeof book.driveFileId !== 'string' || !book.driveFileId || ['__proto__','constructor','prototype'].includes(book.driveFileId)) continue
        mergeFields(merged.books[book.driveFileId] ||= {}, book.fields)
      }
      for (const setting of SYNC_SETTINGS) mergeFields(merged.settings, snapshot.settings?.[setting] ? { [setting]:snapshot.settings[setting] } : {})
    }
    const stamp = (old, value, at = Date.now()) => old && json(old.value) === json(value)
      ? old : { value, at:Math.max(at, (old?.at || 0) + 1), device:this.device }
    let uploaded = 0
    const errors = []
    const observed = new Map()
    let records = await this.library.listAll(); guard()
    for (let book of records) {
      if (book.cloudAccountId && book.cloudAccountId !== accountId) continue
      if (!book.driveFileId) {
        if (!book.content) { errors.push(`${book.title || book.name}: falta el archivo original en este dispositivo`); continue }
        try { book = await this.cloud.uploadBook(book); guard(); if (!book) continue; uploaded++ }
        catch (error) { guard(); errors.push(error.message); continue }
      }
      const id = book.driveFileId
      const old = baseline.books[id] || {}
      const local = {}
      // Cover bytes are separate binary files, never Blob -> JSON ({}), nor
      // device-specific blob: URLs. Reuse the file while the committed cover
      // revision is unchanged; download retries do not re-upload the image.
      let cover = old.cover?.value
      if (book.cover?.size && (!cover || cover.revision !== (book.coverUpdatedAt || 0))) {
        try {
          const saved = await uploadDriveCover(book.cover, `cover-${id}-${crypto.randomUUID()}`); guard()
          cover = { fileId:saved.id, revision:book.coverUpdatedAt || 0, type:book.cover.type }
        } catch (error) { guard(); throw new Error(`No se pudo guardar la portada: ${error.message}`, { cause:error }) }
      }
      const values = { ...metadata(book), visible:true, ...(cover ? { cover } : {}) }
      observed.set(id, metadata(book))
      for (const [field, value] of Object.entries(values)) {
        local[field] = stamp(old[field], value, old[field] ? Date.now() : Number(book.progressUpdatedAt || book.addedAt) || Date.now())
      }
      mergeFields(merged.books[id] ||= {}, local)
    }
    const removals = await this.library.listRemoved(); guard()
    for (const removal of removals) if (removal.driveFileId && removal.cloudAccountId === accountId) {
      mergeFields(merged.books[removal.driveFileId] ||= {}, { visible:stamp(baseline.books[removal.driveFileId]?.visible, false, removal.removedAt) })
    }
    const touched = parse(this.storage, CHANGES_KEY, {})
    for (const setting of SYNC_SETTINGS) {
      const value = this.storage.getItem(setting)
      if (value === null) continue
      // Default plants/view created during boot must not replace a saved room.
      const old = baseline.settings[setting]
      if (!old && !touched[setting] && merged.settings[setting]) continue
      const entry = stamp(old, value, touched[setting] || (old ? Date.now() : 0))
      mergeFields(merged.settings, { [setting]:entry })
    }
    records = await this.library.listAll(); guard()
    const byDrive = new Map(records.filter(b => !b.cloudAccountId || b.cloudAccountId === accountId).map(b => [b.driveFileId,b]))
    const applied = { books:{}, settings:{} }
    for (const [id, fields] of Object.entries(merged.books)) {
      guard()
      let book = byDrive.get(id)
      const removal = (await this.library.listRemoved()).find(r => r.driveFileId === id && r.cloudAccountId === accountId)
      guard()
      if (removal && removal.removedAt > (fields.visible?.at || 0)) {
        fields.visible = { value:false, at:removal.removedAt, device:this.device }
      }
      if (fields.visible?.value === false) {
        const options = { removedAt:fields.visible.at }
        if (book) await this.cloud.removeFromShelf(book, options)
        else await this.library.removeFromShelf({ id:`drive:${id}`, driveFileId:id, cloudAccountId:accountId }, options)
        guard(); applied.books[id] = fields; continue
      }
      const raw = Object.fromEntries(Object.entries(fields).map(([k,v]) => [k,v.value]))
      const values = metadata(raw)
      // This revision describes the image bytes, not just a metadata field.
      // Commit it only together with the downloaded Blob below.
      delete values.coverUpdatedAt
      // Never restore local IDs/handles/contentRevision from another device.
      // A remote book without bytes must take the Drive download path.
      if (!book) {
        book = await this.library.addOrTouch({ ...values, sourceType:'drive', driveFileId:id,
          cloudAccountId:accountId }, { restoreRemoved:true })
        guard()
        if (book) book = await this.library.patch(book.id, {
          ...(values.lastOpenedAt != null ? { lastOpenedAt:values.lastOpenedAt } : {}),
          ...(values.addedAt != null ? { addedAt:values.addedAt } : {})
        })
        guard()
      } else {
        const patch = {}
        const current = metadata(book)
        for (const [field, value] of Object.entries(values)) {
          if (observed.has(id) && json(current[field]) !== json(observed.get(id)[field])) continue
          if (json(current[field]) !== json(value) || field === 'shelfVisualId' && book[field] !== value) patch[field] = value
        }
        if (Object.keys(patch).length) {
          // A local edit made while Drive was loading must win next time.
          const saved = await this.library.patch(book.id, patch, { ifCurrent:latest => active() && json(metadata(latest)) === json(current) })
          guard(); if (!saved) continue
          book = saved
        }
      }
      const cover = fields.cover?.value
      const locallyChangedCover = observed.has(id) && book.coverUpdatedAt !== observed.get(id).coverUpdatedAt
      if (!locallyChangedCover && cover?.fileId && (!book.cover || book.coverUpdatedAt !== cover.revision)) {
        try {
          const blob = await downloadDriveFile(cover.fileId, { mimeType:cover.type }); guard()
          const saved = await this.library.patch(book.id, { cover:blob, coverUpdatedAt:cover.revision }, {
            ifCurrent:latest => active() && latest.coverUpdatedAt === book.coverUpdatedAt && latest.cover?.size === book.cover?.size
          })
          guard(); if (!saved) continue
        } catch (error) { guard(); throw new Error(`No se pudo recuperar la portada: ${error.message}`, { cause:error }) }
      }
      applied.books[id] = fields
    }
    const settingsChanged = []
    for (const setting of SYNC_SETTINGS) {
      const entry = merged.settings[setting]
      if (!entry || typeof entry.value !== 'string') continue
      // Re-check edits that happened while an image was downloading.
      const latestTouched = parse(this.storage, CHANGES_KEY, {})[setting] || 0
      if (latestTouched > (touched[setting] || 0)) continue
      if (this.storage.getItem(setting) !== entry.value) {
        this.storage.setItem(setting, entry.value); settingsChanged.push(setting)
      }
      applied.settings[setting] = entry
    }
    guard()
    await saveBackupCheckpoint(key, applied); guard()
    if (settingsChanged.length) this.onSettings(settingsChanged)
    this.onChange()
    const own = snapshots.filter(s => s.deviceId === this.device).at(-1)
    const snapshot = { schemaVersion:1, deviceId:this.device,
      books:Object.entries(merged.books).map(([driveFileId, fields]) => ({ driveFileId, fields })), settings:merged.settings }
    if (json(own?.books) !== json(snapshot.books) || json(own?.settings) !== json(snapshot.settings)) {
      await writeDriveLibrarySnapshot(snapshot, own?.stateFileId); guard()
    }
    const result = await this.cloud.sync(); guard()
    errors.push(...(result?.errors || []))
    this.onStatus(errors.length ? `Sincronización pendiente: ${errors[0]}` : 'Biblioteca y estantería guardadas en Google Drive')
    return { ...result, uploaded, errors }
  }
}
