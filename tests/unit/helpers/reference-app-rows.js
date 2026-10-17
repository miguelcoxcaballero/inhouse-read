// Frozen SDK callback factory before native placement/order decisions.
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
      onBookRemove: book => bookDataModule().app_book_remove(shelfRefreshHost, book),
      onAddBooks: pickLocalFile,
      coverSrcFor: book => book.cover ?? null,
      waitForCoverAppearance: true,
      onCoverAppearance: (book, appearance, key) => bookDataModule().app_cover_appearance(shelfRefreshHost, book, appearance, key),
      onBookCustomizationChange: (book, fields) => bookDataModule().app_book_customization(shelfRefreshHost, book, fields),
      onShelfPlacementChange: ({ books = [] }) => Promise.all(books.map(({ id, shelfPosition }) => {
        const position = normalizeShelfPosition(shelfPosition)
        return id && (position || shelfPosition === null)
          ? persistBookState(id, { shelfPosition:position }) : Promise.resolve()
      })),
      onBookOrderChange: order => Promise.all(order.map(({ id, shelfOrder }) => persistBookState(id, { shelfOrder })))
    })
}
