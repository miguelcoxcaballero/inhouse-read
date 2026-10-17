// Frozen root book actions before their native port.
export async function persistBookState(bookId, fields) {
  await progressWrites.patch(bookId, fields)
  scheduleLibraryBackup()
}

export async function removeBookFromShelf(book) {
  const ownsPreparation = requestedPreparationId === book.id || activePreparedBookId === book.id
  if (requestedPreparationId === book.id) {
    preparationGeneration += 1
    requestedPreparationId = null
  }
  const cancelledGeneration = preparationGeneration
  preparedBooks.delete(book.id)
  coverUpgrades.delete(book.id)
  const preparingTask = readerPreparationQueue
  const removal = await cloudSync.removeFromShelf(book)
  scheduleLibraryBackup()
  // A selected book may already have a reader engine preloaded in memory.
  // Release it once it settles, without keeping the shelf drop waiting for
  // a file download. A newer selection owns its own reader generation.
  if (ownsPreparation) {
    preparingTask.catch(() => {}).then(() => {
      if (preparationGeneration !== cancelledGeneration || requestedPreparationId ||
          (currentBookId && currentBookId !== book.id) || !els.readerScreen.classList.contains('is-preparing')) return
      reader.close()
      readingExperience.reset()
      currentBookId = null
      activePreparedBookId = null
      els.readerScreen.hidden = true
      els.readerScreen.classList.remove('is-preparing')
      els.readerViewport.innerHTML = ''
    }).catch(error => console.warn('No se pudo liberar la preparación del libro retirado:', error))
  }
  // The shelf removes its model after the drop animation has finished.
  // Refreshing here would interrupt that animation and dispose its scene.
  return removal
}


export function createShelfForRecords(books) {
  return renderBookshelf(els.bookshelfRoot, books, {
      onBookOpen: openBookRecord,
      onPrepareBook: prepareBookOpen,
      onBookDismiss: dismissPreparedPage,
      sections: false,
      sort: 'none',
      // These production providers depend on visual/content fields, not sync acknowledgements/history.
      adoptMetadata: true,
      minimumShelves: 3,
      getBookPreparation: book => preparedBooks.get(book.id),
      getBookGeometryState: book => wordCountQueue.geometryState(book),
      onBookGeometryRetry: book => wordCountQueue.retry(book.id),
      onBookAction: handleCoverAction,
      getBookCloudState: book => bookCloudState(book, { connected:hasDriveSession() }),
      onBookRemove: book => {
        wordCountQueue.cancel(book.id)
        preparedPages.invalidateBook(book.id, 'removed')
        releasePageGate('removed', book.id)
        return removeBookFromShelf(book).then(removal => {
          // The shelf already dropped the book: keep the remembered record set
          // in step so the next identical sync is recognised as "no change"
          // instead of repainting the whole shelf.
          if (shelfRecords) shelfRecords = shelfRecords.filter(record => record.id !== book.id)
          return removal
        })
      },
      onAddBooks: pickLocalFile,
      coverSrcFor: book => book.cover ?? null,
      waitForCoverAppearance: true,
      onCoverAppearance: (book, appearance, key) => library.patch(book.id, {
        coverAppearance: appearance,
        coverAppearanceKey: key
      }).then(record => { scheduleLibraryBackup(); return record }),
      onBookCustomizationChange: (book, fields) => {
        // A prepared reader already shows this book: its title and author follow the spine.
        if ('spineTitleOverride' in fields || 'author' in fields) readingExperience.refreshNames(book.id, fields)
        return persistBookState(book.id, fields)
      },
      onShelfPlacementChange: ({ books = [] }) => Promise.all(books.map(({ id, shelfPosition }) => {
        const position = normalizeShelfPosition(shelfPosition)
        return id && (position || shelfPosition === null)
          ? persistBookState(id, { shelfPosition:position }) : Promise.resolve()
      })),
      onBookOrderChange: order => Promise.all(order.map(({ id, shelfOrder }) => persistBookState(id, { shelfOrder })))
    })
}
