// Frozen 1.7.280 reader-preparation reference, used only by differential tests.
export function prepareBookOpen(book, { settled } = {}) {
  if (requestedPreparationId === book.id && preparedBooks.has(book.id)) {
    // Selected again while its engine is still loaded: the engine is ready,
    // only the page (dropped when the earlier selection ended) may need redoing.
    const generation = preparationGeneration
    const gate = openPageGate(book.id, settled)
    const again = preparedBooks.get(book.id).then(async ready => {
      if (ready && generation === preparationGeneration && activePreparedBookId === book.id) {
        await preparePageStage(book.id, generation, gate)
      }
      return ready
    })
    readerPreparationQueue = again.catch(() => {})
    preparedBooks.set(book.id, again)
    return again
  }
  supersedePreparation('new-selection')
  const generation = preparationGeneration
  requestedPreparationId = book.id
  preparedBooks.clear()
  const fileTask = book.content && (book.sourceType === 'local' || book.sourceType === 'drive')
    ? Promise.resolve(new File([book.content], book.name || book.title || 'libro', {
      type: book.mimeType || book.content.type || ''
    }))
    : needsDriveDownload(book) && hasDriveSession()
      ? cloudSync.downloadForOffline(book) : null
  if (!fileTask) return
  // A locally cached book opens immediately from its saved position. Remote
  // progress reconciles in the background sync, never on the opening path.
  const filesReady = Promise.resolve(fileTask)
  filesReady.catch(() => {})
  const gate = openPageGate(book.id, settled)
  // All preparations share one reader. A newer selection supersedes queued
  // work, and an already loading engine settles before another replaces it.
  const task = readerPreparationQueue.catch(() => {}).then(async () => {
    const file = await filesReady
    if (generation !== preparationGeneration) return false
    await progressWrites.get(book.id)?.catch(() => {})
    const updated = await library.get(book.id)
    if (!updated) return false
    if (generation !== preparationGeneration) return false
    const opened = await openFile(file, { existingRecord: updated, forcedId: book.id, preparing: true, reuseStoredContent:true })
    if (generation !== preparationGeneration) return false
    activePreparedBookId = opened ? book.id : null
    markTiming('engine-opened')
    if (opened) await preparePageStage(book.id, generation, gate)
    return opened
  })
  readerPreparationQueue = task.catch(() => {})
  preparedBooks.set(book.id, task)
  return task
}

// ---- Página preparada ----
// Opening used to start only at the tap: restore the saved place, lay the page
// out, rasterise it, hand it to the 3D book. All of that now happens while the
// book sits lifted off the shelf, once the pull-out animation has finished and
// the main thread is idle, so the tap only plays the animation. The result is
// kept in `preparedPages` under a key of everything it depends on; the tap
// reuses it only when the key still holds and otherwise computes it as before.

const idleSlice = () => new Promise(resolve => {
  if (typeof requestIdleCallback === 'function') requestIdleCallback(() => resolve(), { timeout:250 })
  else setTimeout(resolve, 50)
})

export function openPageGate(bookId, settled) {
  const gate = createStageGate(settled, { idle:idleSlice })
  pageGate = { bookId, gate }
  return gate
}

export function releasePageGate(reason, bookId) {
  if (pageGate && (!bookId || pageGate.bookId === bookId)) pageGate.gate.release(reason)
}

/** The reader is replaced or closed: whatever was prepared (or waiting to be) belongs to the past. */
export function supersedePreparation(reason) {
  preparationGeneration++
  preparedPages.invalidate(reason)
  releasePageGate(reason)
}

export function dismissPreparedPage() {
  preparedPages.invalidate('dismissed')
  releasePageGate('dismissed')
}

/** Everything the prepared page depends on, as it is right now. */
export function pageKeyFor(bookId, record) {
  const box = els.readerViewport.getBoundingClientRect()
  const { fraction, locator } = reader.location
  return {
    bookId, epoch:reader.epoch,
    locator:record?.locator ?? null, fraction:record?.progressFraction || 0,
    location:{ fraction, locator },
    viewport:{ left:box.left, top:box.top, width:box.width, height:box.height },
    pixelRatio:window.devicePixelRatio || 1,
    preferences:JSON.stringify(readingExperience.preferences),
    theme:document.documentElement.getAttribute('data-theme') || '',
    filter:getComputedStyle(els.readerViewport).filter
  }
}

export async function restoreAndSnapshot(record) {
  // Restore after both type settings and final viewport dimensions.
  restoringProgress = true
  try { await reader.goToLocator(record.locator, record.progressFraction || 0) }
  finally { restoringProgress = false }
  markTiming('page-restored')
  const snapshot = await reader.getPageSnapshot({ reuseSettledLayout:true })
  markTiming('page-snapshot')
  return snapshot
}

export async function preparePageStage(bookId, generation, gate) {
  try {
    if (!await gate.wait()) return false
    const current = () => generation === preparationGeneration && activePreparedBookId === bookId && currentBookId === bookId
    if (!current()) return false
    // Without the Rust module (still downloading past the reader's deadline, or
    // unusable) nothing is prepared ahead: the tap computes the page itself.
    if (!preparedPages.isReady() && !await preparedPages.whenReady()) return false
    const record = await library.get(bookId)
    if (!record || !current()) return false
    const ticket = preparedPages.begin(bookId)
    const started = pageKeyFor(bookId, record)
    const snapshot = await restoreAndSnapshot(record)
    if (!snapshot || !current() || !preparedPages.isCurrent(ticket)) return false
    const key = pageKeyFor(bookId, record)
    // Size, preferences or theme moved while the page was being made: it is not the page for either.
    if (pageKeyMismatch({ ...key, location:started.location }, started)) return false
    if (!preparedPages.store(ticket, key, snapshot)) return false
    // Textures and shaders of the 3D page are built now, in idle slices.
    await shelf?.prepareOpeningPage(bookId, snapshot, idleSlice)
    return true
  } catch (error) {
    // Never fail the preparation for this: the tap computes the page itself.
    console.warn('No se pudo preparar la página guardada de antemano:', error)
    return false
  }
}

/** The page the opening animation shows: the prepared one while still valid, otherwise computed now. */
export async function openingPageSnapshot(bookId, record) {
  const prepared = preparedPages.take(pageKeyFor(bookId, record))
  if (prepared) { markTiming('page-reused'); return prepared }
  return restoreAndSnapshot(record)
}
