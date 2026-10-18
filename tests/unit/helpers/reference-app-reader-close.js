// Frozen 1.7.284 reader close coordinator, differential reference.
export async function closeReader() {
  if (closingReader || !currentBookId) return
  closingReader = true
  document.body.classList.add('is-closing-reader')
  const bookId = currentBookId
  // Cancel an optional upgrade; an unfinished first cover must still be saved.
  // Its detached extraction cannot hold up the page snapshot or the animation.
  const coverJob = coverUpgrades.get(bookId)
  if (coverJob?.firstCover) coverJob.retainedOnClose = true
  else coverJob?.controller.abort()
  let stillPage = null, stillFade = null, handedOff = false
  const handoff = () => {
    if (handedOff) return
    handedOff = true
    // The 3D book now carries the page back (reading-display.js may show the
    // Android status bar again as the zoom-out starts).
    document.body.classList.add('is-reader-page-leaving')
    if (stillPage) {
      stillFade = stillPage.animate([{ opacity:1 },{ opacity:0 }], {
        duration:matchMedia('(prefers-reduced-motion: reduce)').matches ? 1 : 220, fill:'both'
      })
      stillFade.finished.then(() => stillPage?.remove()).catch(() => {})
    }
  }
  try {
    if (typeof readingExperience.closeVoice === 'function') readingExperience.closeVoice()
    else readingExperience.voice.stop()
    readingExperience.panel.close()
    // Copy the CURRENT page before destroying the reader. Keep it on screen
    // until the textured 3D leaf has rendered at exactly the same bounds.
    const pageSnapshot = await reader.getPageSnapshot({ reuseSettledLayout:true }).catch(error => {
      console.warn('No se pudo preparar la página de cierre:', error)
      return null
    })
    await progressWrites.get(bookId)?.catch(() => {})
    const position = persistablePosition(pageSnapshot?.location)
    if (position) {
      await library.updateProgress(bookId,position.fraction,position.locator)
      if (hasDriveSession()) cloudSync.scheduleProgress(bookId)
    }
    const book = await library.get(bookId)
    if (pageSnapshot?.source && pageSnapshot.displayBounds?.width) {
      stillPage = document.createElement('div')
      stillPage.className = 'ihr-reader-return-page'
      stillPage.setAttribute('aria-hidden','true')
      // Paper colour plus the PDF desk tone (a translucent image layer).
      const screenStyle = getComputedStyle(els.readerScreen)
      stillPage.style.backgroundColor = screenStyle.backgroundColor
      stillPage.style.backgroundImage = screenStyle.backgroundImage
      // Each engine returned its own detached page, independent of the live
      // reader. Keep those exact pixels for both the still layer and WebGL.
      const image = readerReturnCanvas(pageSnapshot.source, { reuseDetached:true }), bounds = pageSnapshot.displayBounds
      image.style.cssText = `position:absolute;left:${bounds.left}px;top:${bounds.top}px;width:${bounds.width}px;height:${bounds.height}px`
      stillPage.append(image); document.body.append(stillPage)
    }
    supersedePreparation('reader-closed')
    requestedPreparationId = null
    activePreparedBookId = null
    preparedBooks.clear()
    readingExperience.reset()
    const pendingProgress = progressWrites.get(bookId)
    reader.close()
    currentBookId = null
    // Persist the final reader position as soon as its IndexedDB write settles;
    // the shelf animation never waits for Drive's network request.
    if (bookId && hasDriveSession()) {
      Promise.resolve(pendingProgress).then(() => cloudSync.flushProgress(bookId))
        .catch(error => setDriveSyncStatus(`Progreso pendiente: ${error.message}`))
    }
    const geometryReady = isBookLengthReady(book)
    if (geometryReady) shelf?.setReturningBook?.(bookId)
    showScreen('home')
    els.readerToolbar.hidden = true
    // Newly imported books have never had a shelf selection. Populate their
    // slot while the current-page overlay masks the home layout.
    if (!shelf?.hasReaderOrigin(bookId) || !geometryReady) await refreshShelf({ immediate:true })
    // The overlay masks shelf layout and cover decoding until the same page
    // is ready on the 3D mesh. Drive sync continues independently of the flight.
    const returned = geometryReady && await shelf?.returnToShelf(bookId, { pageSnapshot, book, onPageReady:handoff })
    if (!returned) {
      // Unmeasured books keep their accessible preparation row. A cancelled
      // or unavailable return destination also closes through the existing
      // still-page fade, without dropping those pixels in a single frame.
      handoff()
      await stillFade?.finished.catch(() => {})
    }
  } catch (error) {
    console.warn('No se pudo devolver el libro a la estantería:', error)
    reader.close(); currentBookId = null
    readingExperience.reset(); showScreen('home'); els.readerToolbar.hidden = true
  } finally {
    shelf?.setReturningBook?.(null)
    stillFade?.cancel(); stillPage?.remove()
    document.body.classList.remove('is-closing-reader', 'is-reader-page-leaving')
    closingReader = false
    if (cloudRoomChanged) refreshShelf().catch(error => console.warn('Estantería pendiente:', error))
  }
}
