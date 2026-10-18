// Frozen 1.7.286 file-open coordinator.
export async function openFile(file, options = {}) {
  const generation = ++readerLoadGeneration
  const loading = document.getElementById('reader-loading')
  const actions = document.querySelector('.reader-heading-actions')
  els.readerToolbar.hidden = true
  els.readerScreen.setAttribute('aria-busy', 'true')
  actions.inert = true
  loading.hidden = Boolean(options.transition) || Boolean(options.preparing)
  try { return await openFileContent(file, options) }
  finally {
    if (generation === readerLoadGeneration) {
      loading.hidden = true
      actions.inert = false
      els.readerScreen.setAttribute('aria-busy', 'false')
    }
  }
}

export async function openFileContent(file, { existingRecord, forcedId, folderFileName, transition, preparing = false, restoreRemoved = false, onImportReady, reuseStoredContent = false } = {}) {
  // Normally prefetched after the first shelf frame, so this is already settled.
  try { await readingExperience.ready() }
  catch (error) { throw new Error('No se pudo cargar el lector. Comprueba la conexión e inténtalo de nuevo.', { cause:error }) }
  if (!existingRecord && forcedId) existingRecord = await library.get(forcedId)
  if (transition?.isActive && !transition.isActive()) return false
  if (!preparing) {
    supersedePreparation('reader-replaced')
    requestedPreparationId = null
    activePreparedBookId = null
    preparedBooks.clear()
    await readerPreparationQueue.catch(() => {})
  }
  if (transition?.isActive && !transition.isActive()) return false
  readingExperience.reset()
  document.body.classList.remove('is-reader-focus')
  els.readerFocus.setAttribute('aria-pressed', 'false')
  els.readerFocus.setAttribute('aria-label', 'Ocultar controles')
  currentBookId = null
  els.readerToolbar.hidden = true
  if (preparing) {
    els.readerScreen.hidden = false
    els.readerScreen.classList.add('is-preparing')
  } else {
    els.readerScreen.classList.remove('is-preparing')
    showScreen('reader')
  }
  els.readerViewport.innerHTML = ''

  let format
  try {
    format = await reader.open(els.readerViewport, file, {
      initialPage:existingRecord?.locator?.kind === 'pdf-page' ? existingRecord.locator.value : undefined,
      initialLocator:existingRecord?.locator,
      initialFraction:existingRecord?.progressFraction,
      preferences:readingExperience.preferences,
      onRelocate: onReaderRelocate,
      onUserNavigation: () => readingExperience.voice.browse(),
      onFollowLink: href => {
        if (!els.readerScreen.classList.contains('reader-kids-mode')) return readingExperience.jump(null, href)
      },
      onToggleChrome: () => setReaderChromeHidden(!document.body.classList.contains('is-reader-focus'))
    })
  } catch (err) {
    if (transition?.isActive && !transition.isActive()) return false
    if (preparing) {
      els.readerScreen.classList.remove('is-preparing')
      els.readerScreen.hidden = true
    } else {
      showScreen('home')
      if (transition) await transition.onReaderError?.()
    }
    if (err instanceof UnsupportedFormatError) {
      alert(`Formato no admitido: "${file.name}". Usa PDF, EPUB, MOBI, AZW3, FB2 o CBZ.`)
    } else {
      alert(`No se pudo abrir "${file.name}": ${err.message}`)
      console.error(err)
    }
    return false
  }
  if (transition?.isActive && !transition.isActive()) return false

  els.readerFormatBadge.textContent = format.label ?? ''

  const meta = reader.metadata
  const sourceType = existingRecord?.sourceType ?? 'local'
  const baseFields = {
    id: forcedId,
    sourceType,
    driveFileId: existingRecord?.driveFileId,
    cloudAccountId: existingRecord?.cloudAccountId,
    mimeType: existingRecord?.mimeType ?? file.type,
    name: file.name,
    size: file.size,
    contentRevision:reuseStoredContent ? existingRecord?.contentRevision : undefined,
    // Para el grosor real del lomo en la estantería (bookshelf-layout.js):
    // Fixed-page formats report real pages. Reflowable text is measured below;
    // the compressed file size never determines the physical book thickness.
    pageCount: reader.pageCount ?? existingRecord?.pageCount,
    sizeBytes: file.size,
    folderFileName: folderFileName ?? existingRecord?.folderFileName,
    title: normalizeBookTitle(meta.title || existingRecord?.title || file.name, file.name),
    author: normalizeBookAuthor(existingRecord?.author) || normalizeBookAuthor(meta.author ?? meta.creator),
    format: format.label
  }
  let record
  try {
    record = await storeBookFile(library, file, baseFields, { restoreRemoved, reuseStoredContent })
  } catch (err) {
    reader.close()
    readingExperience.reset()
    els.readerScreen.classList.remove('is-preparing')
    showScreen('home')
    await transition?.onReaderError?.()
    throw err
  }
  if (!record) return false
  if (transition?.isActive && !transition.isActive()) return false
  currentBookId = record.id
  scheduleLibraryBackup()
  // Original bytes have already committed and reading can begin immediately.
  // Geometry waits for the complete detached count, never a provisional size.
  wordCountQueue.ensure(record).catch(error => console.warn('No se pudo medir el libro:', error))

  restoringProgress = true
  try {
    await readingExperience.open(record)
    if (transition?.isActive && !transition.isActive()) return false
    if (existingRecord?.locator || existingRecord?.progressFraction) {
      await reader.goToLocator(existingRecord.locator, existingRecord.progressFraction)
    }
  } finally { restoringProgress = false }

  if (!preparing) refreshShelf()
  if (!preparing) extractCoverInBackground(record)
  if (!preparing) await transition?.onReaderReady?.()
  // Android releases its inbox copy only after original bytes are committed.
  if (!preparing) onImportReady?.()
  if (!preparing && !transition) els.readerToolbar.hidden = false
  return true
}
