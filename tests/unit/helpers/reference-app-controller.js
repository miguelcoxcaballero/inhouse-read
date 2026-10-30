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
