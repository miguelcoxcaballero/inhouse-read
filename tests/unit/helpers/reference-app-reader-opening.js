// Frozen 1.7.285 reader-opening reference.
export async function animateReaderPageFromBook({ duration, animateBookToPage, pageSnapshot, isActive }) {
  const screen = els.readerScreen
  if (!screen || screen.hidden || (isActive && !isActive())) return
  const page = pageSnapshot.sourceType === 'pdf-canvas'
    ? screen.querySelector('.pdf-page-wrap:not([hidden]) .pdf-page-canvas') : null
  const measured = page?.getBoundingClientRect()
  const target = measured?.width && measured?.height ? measured : pageSnapshot.displayBounds
  if (!target?.width || !target?.height) throw new Error('La página del lector todavía no está preparada.')
  // The page takes over the screen from here (reading-display.js may hide the
  // Android status bar now, when hiding it cannot resize the page).
  document.body.classList.add('is-reader-page-arriving')
  // Move the SAME textured leaf into its final position. Scaling the whole
  // reader used to stretch its contents and hide the real page behind paper.
  await animateBookToPage({ left:target.left, top:target.top, width:target.width, height:target.height, duration })
  if (isActive && !isActive()) return
  screen.classList.add('is-reader-page-ready')
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
}

export async function openBookRecord(book, ctx) {
  const isActive = () => !ctx.isActive || ctx.isActive()
  const markOpening = () => {
    activeOpeningContext = ctx
    els.readerScreen.classList.add('is-opening-from-book')
    els.readerScreen.classList.remove('is-reader-page-ready')
    els.readerScreen.dataset.openingBook = book.id
    document.body.classList.add('is-opening-reader')
    document.body.classList.remove('is-reader-page-arriving')
  }
  markOpening()
  const ownsOpening = () => activeOpeningContext === ctx
  const clearOpening = () => {
    if (!ownsOpening()) return
    activeOpeningContext = null
    els.readerScreen.classList.remove('is-opening-from-book', 'is-reader-page-ready')
    delete els.readerScreen.dataset.openingBook
    document.body.classList.remove('is-opening-reader', 'is-reader-page-arriving')
  }
  const cancelOpening = () => {
    if (!ownsOpening()) return
    if (pendingLocalReopenId === book.id) {
      pendingLocalReopenId = null
      pendingReaderTransition = null
    }
    clearOpening()
    showScreen('home')
    els.readerToolbar.hidden = true
  }
  ctx.onCancel?.(cancelOpening)
  const closeOpening = options => { cancelOpening(); return ctx.close(options) }
  const transition = {
    isActive,
    onReaderReady: async () => {
      if (ctx.isActive && !ctx.isActive()) { cancelOpening(); return }
      markOpening()
      try {
        // Preloading may finish after edits made on the selected cover.
        // Reconcile their latest names before revealing the existing engine.
        refreshSelectedBookNames(readingExperience, book)
        await revealPreparedReader()
        markTiming('reveal-done')
        const record = await library.get(book.id) || book
        if ((ctx.isActive && !ctx.isActive()) || currentBookId !== book.id) { cancelOpening(); return }
        const pageSnapshot = await openingPageSnapshot(book.id, record)
        if (ctx.isActive && !ctx.isActive()) { cancelOpening(); return }
        if (!pageSnapshot) throw new Error('No se pudo preparar la página guardada del libro.')
        const completed = await ctx.finish?.({ pageSnapshot, animatePage:animateReaderPageFromBook })
        if (completed === false) { cancelOpening(); return }
        els.readerToolbar.hidden = false
        els.readerToolbar.classList.add('is-rising')
        void els.readerToolbar.offsetWidth
        requestAnimationFrame(() => els.readerToolbar.classList.add('is-visible'))
        setTimeout(() => els.readerToolbar.classList.remove('is-rising', 'is-visible'), 500)
      } finally { clearOpening() }
    },
    onReaderError: () => closeOpening()
  }
  const prepared = preparedBooks.get(book.id)
  if (prepared) {
    // Somebody is waiting for the page now: no more waiting for idle time.
    releasePageGate('open', book.id)
    try {
      const ready = await prepared
      if (!isActive()) return
      if (ready && activePreparedBookId === book.id && currentBookId === book.id) {
        preparedBooks.delete(book.id)
        await transition.onReaderReady()
        const record = await library.get(book.id)
        if (record) extractCoverInBackground(record)
        return
      }
    } catch (err) {
      if (!isActive()) return
      preparedBooks.delete(book.id)
      console.warn('La preparación anticipada falló; se abrirá el libro ahora:', err)
    }
  }
  if (!isActive()) return
  if (book.sourceType === 'local' && !needsDriveDownload(book)) {
    // Vía principal: el propio libro se guardó en IndexedDB al importarlo
    // (ver openFile), así que reabrirlo no depende de ninguna API de
    // carpetas ni de volver a pedir el archivo — funciona igual en Android
    // que en escritorio. Sin esto, CADA toque en un libro local acababa
    // abriendo el selector de archivos del sistema, porque nunca se guardaba
    // más que el título/tamaño: no había bytes de los que reabrir nada.
    if (book.content) {
      try {
        const file = new File([book.content], book.name || book.title || 'libro', {
          type: book.mimeType || book.content.type || ''
        })
        await openFile(file, { existingRecord: book, forcedId: book.id, transition, reuseStoredContent:true })
        return
      } catch (err) {
        if (!isActive()) return
        console.warn('No se pudo abrir el libro desde la copia guardada, se intentará otra vía:', err)
      }
    }

    // Compatibilidad con libros importados antes de este cambio (sin
    // `content` guardado): si se guardó en la carpeta elegida por el
    // usuario, léelo de ahí. Solo aplica donde existe la File System Access
    // API (Chrome/Edge de escritorio); en el resto (Android, Safari...)
    // folderFileName nunca se rellenó al importar.
    if (book.folderFileName && isFolderApiSupported()) {
      try {
        const folderHandle = await getSavedFolderHandle()
        if (folderHandle && await ensureFolderPermission(folderHandle)) {
          const file = await readFileFromFolder(folderHandle, book.folderFileName)
          if (!isActive()) return
          if (file) {
            await openFile(file, { existingRecord: book, forcedId: book.id, transition })
            return
          }
        }
      } catch (err) {
        if (!isActive()) return
        console.warn('No se pudo leer el libro de la carpeta guardada, se pedirá manualmente:', err)
      }
    }

    // Fallback: el File original no sobrevive entre sesiones (o no se pudo
    // leer de la carpeta) — hay que volver a pedirlo.
    if (!isActive()) return
    pendingLocalReopenId = book.id
    pendingReaderTransition = transition
    els.filePicker.click()
    // Si el usuario cancela el picker, no hay evento 'change': replegamos
    // la portada para no dejar al usuario mirando un libro que no se abre.
    window.addEventListener('focus', function onFocusBack() {
      window.removeEventListener('focus', onFocusBack)
      setTimeout(() => {
        // Si pendingLocalReopenId sigue siendo este libro, el <input> nunca
        // disparó 'change': el usuario canceló el selector nativo. Hay que
        // limpiar el id pendiente además de replegar la portada, o el
        // próximo archivo que se abra (por cualquier vía) heredaría por
        // error este id y pisaría este registro en la biblioteca.
        if (pendingReaderTransition === transition && isActive() && pendingLocalReopenId === book.id) {
          pendingLocalReopenId = null
          pendingReaderTransition = null
          closeOpening({ instant: true })
        }
      }, 400)
    }, { once: true })
    return
  }
  if (book.driveFileId) {
    try {
      const file = await cloudSync.downloadForOffline(book)
      if (!isActive()) return
      const saved = await library.get(book.id) || book
      await openFile(file, { existingRecord:saved, transition, reuseStoredContent:true })
    } catch (err) {
      if (!isActive()) return
      closeOpening({ instant: true })
      alert(`No se pudo descargar "${book.title}" de Drive: ${err.message}`)
    }
  }
}
