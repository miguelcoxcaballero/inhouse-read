// Frozen root refresh before the native post-load port.
export async function performShelfRefresh({ immediate = false } = {}) {
  const firstRecords = takeFirstRawRecords()
  // A native import changes the library after the boot snapshot was taken.
  // Discard that one-shot snapshot even when its room is deferred, so returning
  // from the reader fetches the newly committed book instead of an empty shelf.
  if (appDisposed || nativeImportShelfGate.deferRefresh()) return
  // Re-rendering a shelf closes its current 3D cover. Defer background
  // changes until the reader transition or close has finished.
  if (document.querySelector('.ihr-flyout')) {
    if (!shelfRefreshQueued) {
      shelfRefreshQueued = true
      const observer = new MutationObserver(() => {
        if (document.querySelector('.ihr-flyout')) return
        observer.disconnect()
        shelfRefreshQueued = false
        refreshShelf()
      })
      observer.observe(document.body, { childList: true, subtree: true })
    }
    return
  }
  const accountId = (driveProfile || getRememberedDriveProfile())?.id
  let storedBooks = await (firstRecords ?? library.listAll())
  // Saved plant meshes and plant/lamp paint are read in parallel. A late read
  // must not hold the shelf back for long: they are generated instead.
  // Layout, lighting and the pointer controllers of the live shelf are Rust-only: the render waits
  // for their modules, fetched with the page head and already compiled by now in practice,
  // alongside the baked reads.
  await Promise.all([shelfBakesSettled(120), requireRustShelf(), requireRustCore()])
  if (firstRecords) storedBooks = recentFirst(storedBooks)
  // The page is being replaced by a newer deploy: building this shelf would only hold that up.
  if (appDisposed || deployCheck?.reloading() || nativeImportShelfGate.deferRefresh()) return
  const normalizedBooks = await Promise.all(storedBooks.map(book => {
    const title = normalizeBookTitle(book.title || book.name)
    const author = normalizeBookAuthor(book.author)
    const patch = {}
    if (title !== book.title) patch.title = title
    if (author !== (book.author || '')) patch.author = author || null
    return Object.keys(patch).length ? library.patch(book.id, patch) : book
  }))
  const books = normalizedBooks.filter(book => isBookVisible(book, accountId))
  if (appDisposed || nativeImportShelfGate.deferRefresh()) return
  // 1.7.290: a received room waits until the active reader/gesture returns.
  if (cloudRoomChanged && (!els.readerScreen.hidden || closingReader)) return
  if (shelf?.isInteracting) return
  if (cloudRoomChanged && els.readerScreen.hidden && !closingReader) {
    shelf?.prepareCloudRoom(); shelfRecords = null
    cloudRoomChanged = false
  }
  // Counting is detached from the active reader and serial, so a home reload,
  // reader close or chapter change never attributes text to another book.
  for (const book of books) wordCountQueue.ensure(book).catch(error => console.warn('Preparación del grosor:', error))
  // Background syncs report a change even when every record came back the
  // same; repainting the whole 3D shelf for them is pure jank.
  if (shelf && shelfRecords && sameBookRecords(shelfRecords, books)
      && shelfLengthStatusVersion === lengthStatusVersion) return
  shelfRecords = books
  shelfLengthStatusVersion = lengthStatusVersion
  // A selection can begin while the IndexedDB read is pending. Let the shelf
  // queue this record set instead of replacing a book already in flight.
  if (!shelf) {
    shelf = renderBookshelf(els.bookshelfRoot, books, {
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
  } else {
    if (!immediate && shelf.queueRefresh) shelf.queueRefresh(books)
    else shelf.update(books)
  }
}
