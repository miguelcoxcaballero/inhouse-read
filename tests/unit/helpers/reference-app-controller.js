// Frozen copy of two decisions of src/js/app.js before they moved to rust-ui/src/app_controller.rs: the
// progress queue's `onSaved` and the reading experience's `onLengthMetadata`. The module-level names they
// used are read from `env`, the application's state from `env.app`.
export function onSaved(env, record, bookId, fields = []) {
  const { app, readerPositionGuard, localRoomBookChanged, hasDriveSession, cloudSync, scheduleLibraryBackup } = env
  if (!app.appDisposed && fields.includes('progressFraction')) readerPositionGuard().remember(bookId,{fraction:record?.progressFraction,locator:record?.locator})
  localRoomBookChanged(bookId, fields)
  if (record?.driveFileId && hasDriveSession()) cloudSync.scheduleProgress(bookId)
  scheduleLibraryBackup()
}

export async function onLengthMetadata(env, record, metadata) {
  const { app, library, isBookLengthReady, wordCountQueue, scheduleLengthRefresh, hasDriveSession, cloudSync, scheduleLibraryBackup } = env
  if (app.appDisposed) return
  // Reuse the visible reader's count rather than parsing this book again in
  // a detached worker. A replacement file must never inherit the old count.
  const revision = record.contentRevision
  const fields = { wordCount:metadata.wordCount, wordCountComplete:metadata.wordCountComplete,
    wordCountVersion:metadata.wordCountVersion, wordCountContentRevision:revision, lengthDirty:true }
  if (!revision || !isBookLengthReady({ ...record, ...fields })) return
  const saved = await library.patch(record.id, fields, {
    ifCurrent:current => Boolean(current?.content) && current.contentRevision === revision
  })
  if (!saved) return
  wordCountQueue.cancel(record.id)
  app.lengthStatusVersion += 1
  scheduleLengthRefresh()
  if (saved.driveFileId && hasDriveSession()) { cloudSync.scheduleProgress(saved.id); scheduleLibraryBackup() }
}

// The book-length queue's `onChange` and the Android import's `onFile`, frozen from app.js before they moved
// to rust-ui/src/app_controller.rs.
export function onLengthChange(env, record) {
  const { app, scheduleLengthRefresh, hasDriveSession, cloudSync, scheduleLibraryBackup } = env
  if (app.appDisposed) return
  app.lengthStatusVersion += 1
  // Batch short books: rebuilding the shelf once per completed chapter or
  // library record would spend far more time drawing than counting text.
  scheduleLengthRefresh()
  if (record?.driveFileId && hasDriveSession()) { cloudSync.scheduleProgress(record.id); scheduleLibraryBackup() }
}

export async function importFile(env, file) {
  const { app, progressWrites, openFile } = env
  await app.shelf?.close()
  await progressWrites.get(app.currentBookId)?.catch(() => {})
  // Resolve the import after the loading wrapper has released its controls.
  // Its successful result already guarantees committed original bytes.
  return openFile(file, { restoreRemoved:true })
}

// app.js's `pagehide`, the length refresh of its first `visibilitychange` listener, and its
// `inhouse-room-setting-changed` and `storage` listeners, frozen before they moved to
// rust-ui/src/app_controller.rs. `env.releasePositionGuard` stands for
// `savedReaderPositionGuard?.free(); savedReaderPositionGuard = null`.
export function pageHide(env, event) {
  const { app, profileView, releaseShelfSoundPreference, readingStreak, nativeImportShelfGate, shelfRefreshQueue,
    wordCountQueue, bookDataModule, driveActionsHost, releasePositionGuard, liveRoom } = env
  if (event.persisted) return
  app.appDisposed = true
  profileView.destroy()
  releaseShelfSoundPreference()
  readingStreak.destroy()
  nativeImportShelfGate.destroy()
  shelfRefreshQueue.dispose()
  clearTimeout(app.lengthRefreshTimer)
  app.lengthRefreshTimer = null
  wordCountQueue.dispose()
  clearTimeout(app.backupTimer)
  if (app.drivePollTimer !== null) bookDataModule().app_drive_poll_update(driveActionsHost)
  clearTimeout(app.roomCaptureTimer)
  releasePositionGuard()
  clearTimeout(app.roomRefreshRetry)
  liveRoom.destroy()
}

export function lengthVisibility(env) {
  const { app, document, scheduleLengthRefresh } = env
  if (!document.hidden && app.shelfLengthStatusVersion !== app.lengthStatusVersion) scheduleLengthRefresh()
}

export function roomSettingChanged(env, e) {
  const { app, libraryBackup, scheduleRoomCapture } = env
  if (app.driveProfile?.id && libraryBackup.markSettingChanged(app.driveProfile.id,e.detail)) scheduleRoomCapture()
}

export function storageChanged(env, e) {
  const { applyCloudSettings } = env
  if (e.storageArea === localStorage && e.key?.startsWith('inhouse-read-shelf-')) applyCloudSettings([e.key])
}
