// Frozen 1.7.287 relocation coordinator.
export function onReaderRelocate({ fraction, cfi, index, textOffset }) {
  els.readerProgressFill.style.width = `${Math.round((fraction ?? 0) * 100)}%`
  readingExperience.relocate()
  if (!currentBookId || restoringProgress || closingReader) return
  const position = persistableRelocation({ fraction, cfi, index, textOffset }, reader.format?.engine)
  if (!position) return
  const bookId = currentBookId
  progressWrites.updateProgress(bookId,position.fraction,position.locator)
    .catch(error => console.warn('No se pudo guardar el progreso:', error))
}

