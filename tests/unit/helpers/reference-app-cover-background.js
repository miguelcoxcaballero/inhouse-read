// Frozen 1.7.288 cover extraction coordinator.
export function extractCoverInBackground(record) {
  if (closingReader || currentBookId !== record.id) return Promise.resolve()
  const epoch = reader.epoch
  const previous = coverUpgrades.get(record.id)
  if (previous?.epoch === epoch) return previous.promise
  const controller = new AbortController()
  const firstCover = !record.cover
  const entry = { epoch, controller, firstCover, retainedOnClose:false }
  const current = () => !appDisposed && !controller.signal.aborted && (
    !closingReader && reader.epoch === epoch && currentBookId === record.id ||
    entry.retainedOnClose && (currentBookId === null || closingReader && currentBookId === record.id)
  )
  const coverNeedsUpgrade = async () => {
    if (!record.cover) return true
    if (record.format !== 'PDF' || typeof createImageBitmap !== 'function') return false
    try {
      const bitmap = await createImageBitmap(record.cover)
      const small = Math.max(bitmap.width, bitmap.height) < 800
      bitmap.close()
      return small
    } catch { return false }
  }
  const task = coverNeedsUpgrade()
    .then(needsCover => needsCover && current() ? reader.getCoverBlob({ signal:controller.signal, ...(firstCover && record.format === 'PDF' ? { retainOnClose:true } : {}) }) : null)
    .then(blob => {
      if (blob?.size > 0 && current()) return library.patch(record.id, { cover:blob, coverUpdatedAt:Date.now() }, { ifCurrent:latest => current() && (!firstCover || !latest.cover && (!record.contentRevision || latest.contentRevision === record.contentRevision)) })
    })
    .then(updated => { if (updated && current()) refreshShelf() })
    .catch(err => { if (!controller.signal.aborted) console.warn('No se pudo extraer la portada:', err) })
    .finally(() => { if (coverUpgrades.get(record.id) === entry) coverUpgrades.delete(record.id); scheduleLibraryBackup() })
  entry.promise = task
  coverUpgrades.set(record.id, entry)
  return task
}
