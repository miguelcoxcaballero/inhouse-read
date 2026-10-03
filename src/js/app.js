import { LibraryStore, sameBookRecords } from './library-store.js'
import { bookCloudState, isBookVisible, storeBookFile } from './book-storage-policy.js'
import { renderBookshelf } from './bookshelf.js'
import { ReaderController, UnsupportedFormatError } from './readers/reader-controller.js'
import {
  isDriveConfigured, requestDriveAccess, listAllDriveBooks, hasDriveSession,
  getDriveProfile, getRememberedDriveProfile, signOutDrive, cancelDriveConnection
} from './drive-client.js'
import { CloudSync } from './cloud-sync.js'
import { restoreLegacyBookBytes } from './legacy-book-recovery.js'
import {
  isFolderApiSupported, getSavedFolderHandle, ensureFolderPermission, readFileFromFolder
} from './local-folder-store.js'
import { initAndroidUpdateChecks, offerAvailableAndroidUpdate } from './android-update.js'
import { initContentFreshnessChecks } from './content-freshness.js'
import { registerOfflineShell } from './offline-shell.js'
import { initAndroidFileImports } from './android-file-import.js'
import { initReadingDisplay } from './reading-display.js'
import { normalizeBookAuthor, normalizeBookTitle } from './book-title.js'
import { normalizeShelfPosition } from './book-colors.js'
import { ReaderExperience } from './readers/reader-experience.js'
import { classifyTapZone, ZONE } from './gestures.js'
import { markTiming } from './perf-marks.js'
import { createPreparedPageCache, createStageGate, pageKeyMismatch } from './prepared-page.js'
import { createBookLengthQueue, isBookLengthReady } from './book-length-queue.js'
import { persistablePosition, persistableRelocation } from './readers/persistable-position.js'

const library = new LibraryStore()
const reader = new ReaderController()

const els = {
  homeScreen: document.getElementById('home-screen'),
  readerScreen: document.getElementById('reader-screen'),
  bookshelfRoot: document.getElementById('bookshelf-root'),
  readerViewport: document.getElementById('reader-viewport'),
  readerToolbar: document.getElementById('reader-toolbar'),
  readerBack: document.getElementById('reader-back'),
  readerFocus: document.getElementById('reader-focus'),
  readerPrev: document.getElementById('reader-prev'),
  readerNext: document.getElementById('reader-next'),
  readerProgressFill: document.getElementById('reader-progress-fill'),
  readerFormatBadge: document.getElementById('reader-format-badge'),
  themeToggle: document.getElementById('theme-toggle'),
  addLocalBtn: document.getElementById('add-local-btn'),
  addDriveBtn: document.getElementById('add-drive-btn'),
  filePicker: document.getElementById('file-picker'),
  driveModal: document.getElementById('drive-modal'),
  driveList: document.getElementById('drive-list'),
  driveClose: document.getElementById('drive-close'),
  driveStatus: document.getElementById('drive-status'),
  driveProfile: document.getElementById('drive-profile'),
  driveProfileBtn: document.getElementById('drive-profile-btn'),
  driveProfileMenu: document.getElementById('drive-profile-menu'),
  driveProfileAvatar: document.getElementById('drive-profile-avatar'),
  driveProfileAvatarMenu: document.getElementById('drive-profile-avatar-menu'),
  driveProfileInitial: document.getElementById('drive-profile-initial'),
  driveProfileInitialMenu: document.getElementById('drive-profile-initial-menu'),
  driveProfileName: document.getElementById('drive-profile-name'),
  driveProfileEmail: document.getElementById('drive-profile-email'),
  driveSyncStatus: document.getElementById('drive-sync-status'),
  driveUploadScreen: document.getElementById('drive-upload-screen'),
  driveUploadBook: document.getElementById('drive-upload-book'),
  driveSyncBtn: document.getElementById('drive-sync-btn'),
  driveSignOutBtn: document.getElementById('drive-signout-btn'),
  driveConnectBtn: document.getElementById('drive-connect-btn'),
  driveThemeToggle: document.getElementById('drive-theme-toggle'),
  appVersion: document.getElementById('app-version')
}

let shelf = null
let shelfRecords = null
let currentBookId = null
let pendingLocalReopenId = null
let pendingReaderTransition = null
const preparedBooks = new Map()
let preparationGeneration = 0
let requestedPreparationId = null
let activePreparedBookId = null
let activeOpeningContext = null
let closingReader = false
let readerPreparationQueue = Promise.resolve()
// The page the open book lands on, prepared while the book is lifted off the
// shelf (see prepared-page.js and the 'Página preparada' block below).
const preparedPages = createPreparedPageCache()
let pageGate = null
const coverUpgrades = new Map()
const progressWrites = new Map()
let driveProfile = null
let restoringProgress = false
let shelfRefreshQueued = false
let lengthStatusVersion = 0
let shelfLengthStatusVersion = -1
let lengthRefreshTimer = null
let appDisposed = false
let driveUploadsInFlight = 0
const cloudSync = new CloudSync(library, {
  onStatus: setDriveSyncStatus,
  onChange: refreshShelf
})
function scheduleLengthRefresh() {
  if (appDisposed || document.hidden || !els.readerScreen.hidden || lengthRefreshTimer != null) return
  lengthRefreshTimer = setTimeout(() => {
    lengthRefreshTimer = null
    if (!appDisposed && !document.hidden && els.readerScreen.hidden) {
      refreshShelf().catch(error => console.warn('No se pudo actualizar la estantería:', error))
    }
  }, 80)
}
const wordCountQueue = createBookLengthQueue(library, {
  onChange: record => {
    if (appDisposed) return
    lengthStatusVersion += 1
    // Batch short books: rebuilding the shelf once per completed chapter or
    // library record would spend far more time drawing than counting text.
    scheduleLengthRefresh()
    if (record?.driveFileId && hasDriveSession()) cloudSync.scheduleProgress(record.id)
  },
  onError: error => console.warn('No se pudo contar el texto del libro:', error)
})
async function persistBookState(bookId, fields) {
  const previous = progressWrites.get(bookId) || Promise.resolve()
  const write = previous.catch(() => {}).then(() => library.patch(bookId, {
    ...fields, progressUpdatedAt:Date.now(), progressDirty:true
  })).then(record => { if (record?.driveFileId && hasDriveSession()) cloudSync.scheduleProgress(bookId) })
  progressWrites.set(bookId, write)
  try { await write } finally { if (progressWrites.get(bookId) === write) progressWrites.delete(bookId) }
}
const readingExperience = new ReaderExperience(reader, { persist:persistBookState })

// ---- Tema (idéntico al patrón de Inhouse Notes: data-theme + persistido) ----

// The browser chrome (PWA/Chrome toolbar) takes the header's surface colour.
function syncThemeColor(theme) {
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#1c1c1c' : '#ffffff')
}

function initTheme() {
  const saved = localStorage.getItem('inhouse-read-theme')
  const preferred = saved ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
  document.documentElement.setAttribute('data-theme', preferred)
  syncThemeColor(preferred)
}

els.themeToggle.addEventListener('click', () => {
  const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'
  document.documentElement.setAttribute('data-theme', next)
  syncThemeColor(next)
  localStorage.setItem('inhouse-read-theme', next)
  if (els.driveThemeToggle) els.driveThemeToggle.checked = next === 'dark'
})

// ---- Navegación entre pantallas ----

function showScreen(name) {
  if (name !== 'reader') {
    document.body.classList.remove('is-reader-focus')
    const header = document.querySelector('.app-header')
    header.style.removeProperty('color-scheme')
    delete header.dataset.readingTheme
  }
  document.body.classList.toggle('is-reading', name === 'reader')
  els.homeScreen.hidden = name !== 'home'
  els.readerScreen.hidden = name !== 'reader'
  shelf?.setPresentationActive?.(name === 'home')
  if (name === 'home' && shelfLengthStatusVersion !== lengthStatusVersion) scheduleLengthRefresh()
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && shelfLengthStatusVersion !== lengthStatusVersion) scheduleLengthRefresh()
})
// A discarded page has no shelf to update. Keep the queue alive for bfcache
// restores, but cancel callbacks for a document that is actually leaving.
addEventListener('pagehide', event => {
  if (event.persisted) return
  appDisposed = true
  clearTimeout(lengthRefreshTimer)
  lengthRefreshTimer = null
  wordCountQueue.dispose()
})

function isAndroidShell() {
  return /\bInhouseReadApp\/\d/i.test(navigator.userAgent || '')
}

// ---- Home / estantería ----
// Contrato de renderBookshelf(container, books, options) documentado en el
// propio src/js/bookshelf.js (cabecera del archivo).

async function refreshShelf({ immediate = false } = {}) {
  if (appDisposed) return
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
  const storedBooks = await library.listAll()
  if (appDisposed) return
  const normalizedBooks = await Promise.all(storedBooks.map(book => {
    const title = normalizeBookTitle(book.title || book.name)
    const author = normalizeBookAuthor(book.author)
    const patch = {}
    if (title !== book.title) patch.title = title
    if (author !== (book.author || '')) patch.author = author || null
    return Object.keys(patch).length ? library.patch(book.id, patch) : book
  }))
  const books = normalizedBooks.filter(book => isBookVisible(book, accountId))
  if (appDisposed) return
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
      }),
      onBookCustomizationChange: (book, fields) => persistBookState(book.id, fields),
      onShelfPlacementChange: ({ books = [] }) => Promise.all(books.map(({ id, shelfPosition }) => {
        const position = normalizeShelfPosition(shelfPosition)
        return id && (position || shelfPosition === null)
          ? persistBookState(id, { shelfPosition:position }) : Promise.resolve()
      })),
      onBookOrderChange: order => Promise.all(order.map(({ id, shelfOrder }) => library.patch(id, { shelfOrder })))
    })
  } else {
    if (!immediate && shelf.queueRefresh) shelf.queueRefresh(books)
    else shelf.update(books)
  }
}

// Hiding the controls only hides them: the header and the toolbar keep their
// margins (see reading.css), so the page never repaginates or refits. The
// toolbar's own `hidden` attribute is left to the opening and closing flights.
function setReaderChromeHidden(hidden) {
  if (els.readerScreen.hidden || els.readerScreen.classList.contains('is-preparing') ||
      els.readerScreen.classList.contains('is-opening-from-book')) return
  const focus = Boolean(hidden)
  document.body.classList.toggle('is-reader-focus', focus)
  els.readerFocus.setAttribute('aria-pressed', String(focus))
  els.readerFocus.setAttribute('aria-label', focus ? 'Mostrar controles' : 'Ocultar controles')
  if (focus) els.readerViewport.focus({ preventScroll:true })
}

els.readerFocus.addEventListener('click', () => setReaderChromeHidden(true))
// The blank margins left by hidden controls still take taps like the page does:
// the edges turn pages and the centre brings the controls back. Their buttons
// are invisible and unreachable, so only a tap on the margin itself lands here.
for (const margin of [document.querySelector('.app-header'), els.readerToolbar]) {
  margin.addEventListener('click', event => {
    if (event.target !== margin || !document.body.classList.contains('is-reader-focus')) return
    const bounds = margin.getBoundingClientRect()
    const zone = classifyTapZone(event.clientX - bounds.left, bounds.width)
    if (zone === ZONE.CENTER) return setReaderChromeHidden(false)
    const forward = (zone === ZONE.NEXT) !== reader.rtl
    readingExperience.step(forward ? 1 : -1)
  })
}
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && document.body.classList.contains('is-reader-focus') && !readingExperience.panel.open) {
    setReaderChromeHidden(false)
    els.readerFocus.focus({ preventScroll:true })
    event.preventDefault()
  }
})

async function removeBookFromShelf(book) {
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

async function animateReaderPageFromBook({ duration, animateBookToPage, pageSnapshot, isActive }) {
  const screen = els.readerScreen
  if (!screen || screen.hidden || (isActive && !isActive())) return
  const page = pageSnapshot.sourceType === 'pdf-canvas'
    ? screen.querySelector('.pdf-page-wrap:not([hidden]) .pdf-page-canvas') : null
  const measured = page?.getBoundingClientRect()
  const target = measured?.width && measured?.height ? measured : pageSnapshot.displayBounds
  if (!target?.width || !target?.height) throw new Error('La página del lector todavía no está preparada.')
  // Move the SAME textured leaf into its final position. Scaling the whole
  // reader used to stretch its contents and hide the real page behind paper.
  await animateBookToPage({ left:target.left, top:target.top, width:target.width, height:target.height, duration })
  if (isActive && !isActive()) return
  screen.classList.add('is-reader-page-ready')
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
}

async function openBookRecord(book, ctx) {
  const isActive = () => !ctx.isActive || ctx.isActive()
  const markOpening = () => {
    activeOpeningContext = ctx
    els.readerScreen.classList.add('is-opening-from-book')
    els.readerScreen.classList.remove('is-reader-page-ready')
    els.readerScreen.dataset.openingBook = book.id
    document.body.classList.add('is-opening-reader')
  }
  markOpening()
  const ownsOpening = () => activeOpeningContext === ctx
  const clearOpening = () => {
    if (!ownsOpening()) return
    activeOpeningContext = null
    els.readerScreen.classList.remove('is-opening-from-book', 'is-reader-page-ready')
    delete els.readerScreen.dataset.openingBook
    document.body.classList.remove('is-opening-reader')
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
  if (book.sourceType === 'local') {
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
  if (book.sourceType === 'drive') {
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

function pickLocalFile() {
  pendingLocalReopenId = null
  els.filePicker.click()
}

els.addLocalBtn.addEventListener('click', pickLocalFile)
els.addDriveBtn.addEventListener('click', openDriveModal)

els.filePicker.addEventListener('change', async () => {
  const file = els.filePicker.files?.[0]
  els.filePicker.value = ''
  if (!file) return

  // Reabrir un libro ya conocido (el fallback de arriba): no hay que
  // volver a guardarlo en la carpeta, solo abrirlo con el mismo id.
  if (pendingLocalReopenId) {
    const forcedId = pendingLocalReopenId
    pendingLocalReopenId = null
    const transition = pendingReaderTransition
    pendingReaderTransition = null
    try { await openFile(file, { forcedId, transition }) }
    catch (error) { alert(error.message) }
    return
  }

  // IndexedDB keeps the original bytes on this device without a folder picker
  // or a Google connection. The folder path above only recovers legacy books.
  try { await openFile(file, { restoreRemoved:true }) }
  catch (error) { alert(error.message) }
})

// ---- Apertura y lectura ----

let readerLoadGeneration = 0
async function openFile(file, options = {}) {
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

async function openFileContent(file, { existingRecord, forcedId, folderFileName, transition, preparing = false, restoreRemoved = false, onImportReady, reuseStoredContent = false } = {}) {
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
      onUserNavigation: () => readingExperience.voice.stop(),
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

function prepareBookOpen(book, { settled } = {}) {
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
    : book.sourceType === 'drive' && hasDriveSession()
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
    if (opened) await extractCoverInBackground(await library.get(book.id) || updated)
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

function openPageGate(bookId, settled) {
  const gate = createStageGate(settled, { idle:idleSlice })
  pageGate = { bookId, gate }
  return gate
}

function releasePageGate(reason, bookId) {
  if (pageGate && (!bookId || pageGate.bookId === bookId)) pageGate.gate.release(reason)
}

/** The reader is replaced or closed: whatever was prepared (or waiting to be) belongs to the past. */
function supersedePreparation(reason) {
  preparationGeneration++
  preparedPages.invalidate(reason)
  releasePageGate(reason)
}

function dismissPreparedPage() {
  preparedPages.invalidate('dismissed')
  releasePageGate('dismissed')
}

/** Everything the prepared page depends on, as it is right now. */
function pageKeyFor(bookId, record) {
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

async function restoreAndSnapshot(record) {
  // Restore after both type settings and final viewport dimensions.
  restoringProgress = true
  try { await reader.goToLocator(record.locator, record.progressFraction || 0) }
  finally { restoringProgress = false }
  markTiming('page-restored')
  const snapshot = await reader.getPageSnapshot()
  markTiming('page-snapshot')
  return snapshot
}

async function preparePageStage(bookId, generation, gate) {
  try {
    if (!await gate.wait()) return false
    const current = () => generation === preparationGeneration && activePreparedBookId === bookId && currentBookId === bookId
    if (!current()) return false
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
async function openingPageSnapshot(bookId, record) {
  const prepared = preparedPages.take(pageKeyFor(bookId, record))
  if (prepared) { markTiming('page-reused'); return prepared }
  return restoreAndSnapshot(record)
}

// A resized window or a rotated phone changes the page's pixels and layout.
globalThis.addEventListener('resize', () => preparedPages.invalidate('resize'))
// Settings can change while a lifted book still owns the hidden reader.
document.addEventListener('change', event => {
  if (event.target.closest?.('.reading-panel [data-pref]')) preparedPages.invalidate('preferences')
})
document.addEventListener('click', event => {
  if (event.target.closest?.('.reading-panel [data-theme], .reading-panel [data-size-step], .reading-panel [data-reset]')) {
    preparedPages.invalidate('preferences')
  }
})
new MutationObserver(() => preparedPages.invalidate('theme')).observe(document.documentElement,
  { attributes:true, attributeFilter:['data-theme'] })
if (typeof ResizeObserver === 'function') {
  let viewportBox = null
  new ResizeObserver(() => {
    const box = els.readerViewport.getBoundingClientRect()
    const key = `${box.width}x${box.height}`
    if (viewportBox !== null && key !== viewportBox) preparedPages.invalidate('viewport')
    viewportBox = key
  }).observe(els.readerViewport)
}

async function revealPreparedReader() {
  showScreen('reader')
  els.readerScreen.classList.remove('is-preparing')
}

async function handleCoverAction(action, book, button) {
  button.disabled = true
  // The shelf renders a long and a short (narrow screens) label; keep both in
  // step, each with its own wording so the short one never truncates.
  const labels = button.querySelectorAll('span').length ? [...button.querySelectorAll('span')] : [button]
  const originals = labels.map(label => label.textContent)
  const originalAria = button.getAttribute('aria-label')
  const setLabel = (text, short = text) => {
    labels.forEach(label => { label.textContent = label.classList.contains('ihr-btn__label--short') ? short : text })
    button.setAttribute('aria-label', text)
  }
  const restoreLabel = () => {
    labels.forEach((label, index) => { label.textContent = originals[index] })
    if (originalAria) button.setAttribute('aria-label', originalAria)
    else button.removeAttribute('aria-label')
  }
  let saved = false
  setLabel(action === 'offline' ? 'Descargando…' : 'Guardando…', action === 'offline' ? 'Offline…' : 'Drive…')
  button.setAttribute('aria-busy', 'true')
  try {
    if (action === 'offline') {
      if (book.content) {
        setLabel('Disponible offline', 'Offline')
        saved = true
        return
      }
      if (!hasDriveSession()) await requestDriveAccess()
      if (book.sourceType === 'drive') {
        await cloudSync.downloadForOffline(book)
      } else throw new Error('Este libro ya tiene su copia en el dispositivo.')
      setLabel('Disponible offline', 'Offline')
      saved = true
    } else if (action === 'drive') {
      if (!hasDriveSession()) throw new Error('Conecta tu cuenta de Google para subir este libro.')
      const updated = await uploadBookToDrive(book)
      if (!updated) return
      Object.assign(book, updated)
      const status = document.createElement('span')
      status.className = 'ihr-btn ihr-btn--quiet ihr-flyout__cloud-saved'
      status.textContent = 'Guardado en Google Drive'
      status.setAttribute('role', 'status')
      button.replaceWith(status)
      saved = true
    }
  } catch (error) {
    restoreLabel()
    await reportDriveConnectionError(error)
  } finally {
    button.disabled = saved
    button.removeAttribute('aria-busy')
  }
}

async function uploadBookToDrive(book) {
  driveUploadsInFlight += 1
  try {
    const updated = await cloudSync.uploadBook(book)
    if (!updated) return null
    // The file is saved already. Its progress update stays asynchronous so a
    // slow network cannot hold up opening the cover or returning to the shelf.
    cloudSync.flushProgress(updated.id)
      .catch(error => setDriveSyncStatus(`Progreso pendiente: ${error.message}`))
    setDriveSyncStatus('Guardado en Google Drive')
    return updated
  } finally {
    driveUploadsInFlight = Math.max(0, driveUploadsInFlight - 1)
    if (!driveUploadsInFlight) {
      els.driveUploadScreen.hidden = true
      els.driveUploadScreen.setAttribute('aria-busy', 'false')
    }
  }
}

function setDriveSyncStatus(message, syncing = false) {
  els.driveSyncStatus.textContent = message
  els.driveSyncStatus.classList.toggle('is-syncing', syncing)
}

function setProfileAvatar(profile) {
  const initial = (profile.name || profile.email || 'G').trim().charAt(0).toUpperCase() || 'G'
  for (const node of [els.driveProfileInitial, els.driveProfileInitialMenu]) node.textContent = initial
  for (const image of [els.driveProfileAvatar, els.driveProfileAvatarMenu]) {
    if (profile.photo) {
      image.src = profile.photo
      image.hidden = false
      image.previousElementSibling.hidden = true
    } else {
      image.removeAttribute('src')
      image.hidden = true
      image.previousElementSibling.hidden = false
    }
  }
}

async function loadDriveAccountProfile() {
  if (!hasDriveSession()) {
    driveProfile = null
    cloudSync.reset()
    els.driveProfile.hidden = true
    els.driveConnectBtn.hidden = false
    els.themeToggle.hidden = false
    els.driveProfileMenu.hidden = true
    els.driveProfileBtn.setAttribute('aria-expanded', 'false')
    return null
  }
  els.driveProfile.hidden = false
  els.driveConnectBtn.hidden = true
  els.themeToggle.hidden = true
  try {
    driveProfile = await getDriveProfile()
  } catch (error) {
    console.warn('No se pudo cargar el perfil de Google:', error)
    if (!hasDriveSession()) return loadDriveAccountProfile()
    driveProfile = getRememberedDriveProfile()
    if (!driveProfile?.id) throw new Error('No se pudo identificar la cuenta de Google. Vuelve a conectar.')
    setDriveSyncStatus(`Perfil guardado · ${error.message}`)
  }
  cloudSync.setProfile(driveProfile)
  els.driveProfileName.textContent = driveProfile.name
  els.driveProfileEmail.textContent = driveProfile.email
  els.driveProfileBtn.setAttribute('aria-label', driveProfile.email ? `Cuenta de Google: ${driveProfile.email}` : 'Cuenta de Google')
  els.driveProfileBtn.title = driveProfile.name
  setProfileAvatar(driveProfile)
  return driveProfile
}

async function syncLibraryToDrive({ silent = false } = {}) {
  if (!hasDriveSession()) {
    if (silent) {
      // Android uses the same PKCE refresh-token flow as Inhouse Notes.
      const nativeShell = isAndroidShell()
      if (!nativeShell || !getRememberedDriveProfile()) return
      try { await requestDriveAccess({ interactive: false }) } catch { return }
    } else await requestDriveAccess()
  }
  const profile = await loadDriveAccountProfile()
  if (!profile) {
    if (silent) return
    throw new Error('Sesión caducada. Pulsa Conectar.')
  }
  try { await restoreLegacyBookBytes(library) }
  catch (error) { console.warn('No se pudieron recuperar libros antiguos de la carpeta local:', error) }
  return cloudSync.sync()
}

const authNotice = document.getElementById('drive-auth-notice')
const authMessage = document.getElementById('drive-auth-message')
const authRetry = document.getElementById('drive-auth-retry')
const authCancel = document.getElementById('drive-auth-cancel')
function showAuthNotice(message, { retry = false, pending = false } = {}) {
  authMessage.textContent = message
  authNotice.hidden = !message
  authRetry.hidden = !retry
  authCancel.hidden = !pending
}

async function connectGoogleAccount() {
  els.driveConnectBtn.disabled = true
  showAuthNotice('Completa el acceso en Google.', { pending: true })
  try {
    await requestDriveAccess()
    showAuthNotice('')
    await syncLibraryToDrive()
  }
  catch (error) { await reportDriveConnectionError(error) }
  finally { els.driveConnectBtn.disabled = false }
}
els.driveConnectBtn.addEventListener('click', connectGoogleAccount)
authRetry.addEventListener('click', connectGoogleAccount)
authCancel.addEventListener('click', () => { cancelDriveConnection(); showAuthNotice('') })
document.getElementById('drive-auth-dismiss').addEventListener('click', () => { authNotice.hidden = true })
globalThis.addEventListener('inhouse-drive-auth', event => {
  if (event.detail.connected) {
    showAuthNotice('')
    syncLibraryToDrive().catch(reportDriveConnectionError)
  } else if (event.detail.error) showAuthNotice(event.detail.error, { retry: true })
})

async function reportDriveConnectionError(error) {
  if (error?.code === 'ANDROID_SHELL_OUTDATED') {
    if (await offerAvailableAndroidUpdate()) return
    showAuthNotice('Actualiza la app para conectar Drive.', { retry: true })
    return
  }
  showAuthNotice(error.message === 'Conexión cancelada.' ? '' : `No se pudo conectar. ${error.message}`, { retry: true })
}
els.driveThemeToggle.addEventListener('change', () => {
  const theme = els.driveThemeToggle.checked ? 'dark' : 'light'
  document.documentElement.setAttribute('data-theme', theme)
  syncThemeColor(theme)
  localStorage.setItem('inhouse-read-theme', theme)
})

els.driveProfileBtn.addEventListener('click', () => {
  const open = els.driveProfileMenu.hidden
  els.driveProfileMenu.hidden = !open
  els.driveProfileBtn.setAttribute('aria-expanded', String(open))
  if (open) els.driveThemeToggle.focus()
})
document.addEventListener('click', event => {
  if (!els.driveProfile.contains(event.target)) {
    els.driveProfileMenu.hidden = true
    els.driveProfileBtn.setAttribute('aria-expanded', 'false')
  }
})
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    const wasOpen = !els.driveProfileMenu.hidden
    els.driveProfileMenu.hidden = true
    els.driveProfileBtn.setAttribute('aria-expanded', 'false')
    if (wasOpen) els.driveProfileBtn.focus()
  }
})
els.driveSyncBtn.addEventListener('click', async () => {
  els.driveSyncBtn.disabled = true
  try { await syncLibraryToDrive() }
  catch (error) { setDriveSyncStatus(`No se pudo sincronizar: ${error.message}`) }
  finally { els.driveSyncBtn.disabled = false }
})
els.driveSignOutBtn.addEventListener('click', () => {
  signOutDrive()
  cloudSync.reset()
  driveProfile = null
  els.driveProfileMenu.hidden = true
  els.driveProfile.hidden = true
  els.driveConnectBtn.hidden = false
  els.themeToggle.hidden = false
  showAuthNotice('')
  els.driveProfileBtn.setAttribute('aria-expanded', 'false')
  refreshShelf()
})
for (const image of [els.driveProfileAvatar, els.driveProfileAvatarMenu]) {
  image.addEventListener('error', () => {
    image.hidden = true
    image.previousElementSibling.hidden = false
  })
}

/** No bloquea la apertura del libro: la portada se guarda para la próxima visita a la estantería. */
function extractCoverInBackground(record) {
  const epoch = reader.epoch
  const previous = coverUpgrades.get(record.id)
  if (previous?.epoch === epoch) return previous.promise
  const current = () => reader.epoch === epoch && currentBookId === record.id
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
  const entry = { epoch }
  const task = coverNeedsUpgrade()
    .then(needsCover => needsCover && current() ? reader.getCoverBlob() : null)
    .then(blob => {
      if (blob?.size > 0 && current()) return library.patch(record.id, { cover:blob, coverUpdatedAt:Date.now() }, { ifCurrent:current })
    })
    .then(updated => { if (updated) refreshShelf() })
    .catch(err => console.warn('No se pudo extraer la portada:', err))
    .finally(() => { if (coverUpgrades.get(record.id) === entry) coverUpgrades.delete(record.id) })
  entry.promise = task
  coverUpgrades.set(record.id, entry)
  return task
}

function onReaderRelocate({ fraction, cfi, index, textOffset }) {
  els.readerProgressFill.style.width = `${Math.round((fraction ?? 0) * 100)}%`
  readingExperience.relocate()
  if (!currentBookId || restoringProgress) return
  const position = persistableRelocation({ fraction, cfi, index, textOffset }, reader.format?.engine)
  if (!position) return
  const bookId = currentBookId
  const previous = progressWrites.get(bookId) || Promise.resolve()
  const write = previous.catch(() => {}).then(() => library.updateProgress(bookId,position.fraction,position.locator))
    .then(record => { if (record?.driveFileId && hasDriveSession()) cloudSync.scheduleProgress(bookId) })
  progressWrites.set(bookId, write)
  write.catch(error => console.warn('No se pudo guardar el progreso:', error))
    .finally(() => { if (progressWrites.get(bookId) === write) progressWrites.delete(bookId) })
}

els.readerBack.addEventListener('click', async () => {
  if (closingReader || !currentBookId) return
  closingReader = true
  document.body.classList.add('is-closing-reader')
  const bookId = currentBookId
  let stillPage = null, stillFade = null, handedOff = false
  const handoff = () => {
    if (handedOff) return
    handedOff = true
    if (stillPage) {
      stillFade = stillPage.animate([{ opacity:1 },{ opacity:0 }], {
        duration:matchMedia('(prefers-reduced-motion: reduce)').matches ? 1 : 220, fill:'both'
      })
      stillFade.finished.then(() => stillPage?.remove()).catch(() => {})
    }
  }
  try {
    readingExperience.voice.stop()
    readingExperience.panel.close()
    // Copy the CURRENT page before destroying the reader. Keep it on screen
    // until the textured 3D leaf has rendered at exactly the same bounds.
    const pageSnapshot = await reader.getPageSnapshot().catch(error => {
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
      const image = document.createElement('canvas'), bounds = pageSnapshot.displayBounds
      image.width = pageSnapshot.source.width; image.height = pageSnapshot.source.height
      image.getContext('2d').drawImage(pageSnapshot.source,0,0)
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
    showScreen('home')
    els.readerToolbar.hidden = true
    // Newly imported books have never had a shelf selection. Populate their
    // slot while the current-page overlay masks the home layout.
    const geometryReady = isBookLengthReady(book)
    if (!shelf?.hasReaderOrigin(bookId) || !geometryReady) await refreshShelf({ immediate:true })
    // The overlay masks shelf layout and cover decoding until the same page
    // is ready on the 3D mesh. Drive sync continues independently of the flight.
    if (geometryReady) await shelf?.returnToShelf(bookId, { pageSnapshot, book, onPageReady:handoff })
    else {
      // Never invent a physical volume while a long original is still being
      // measured. Close promptly, retain its accessible preparation row, and
      // let the final book appear after the detached job commits.
      handoff()
      await stillFade?.finished.catch(() => {})
    }
  } catch (error) {
    console.warn('No se pudo devolver el libro a la estantería:', error)
    reader.close(); currentBookId = null
    readingExperience.reset(); showScreen('home'); els.readerToolbar.hidden = true
  } finally {
    stillFade?.cancel(); stillPage?.remove()
    document.body.classList.remove('is-closing-reader')
    closingReader = false
  }
})
els.readerPrev.addEventListener('click', () => readingExperience.step(-1))
els.readerNext.addEventListener('click', () => readingExperience.step(1))

// ---- Google Drive ----

function openDriveModal() {
  els.driveModal.hidden = false
  loadDriveFiles()
}

els.driveClose.addEventListener('click', () => { els.driveModal.hidden = true })

async function loadDriveFiles() {
  els.driveStatus.textContent = 'Conectando con Drive…'
  els.driveList.innerHTML = ''
  try {
    if (!hasDriveSession()) await requestDriveAccess()
    await loadDriveAccountProfile()
    const files = await listAllDriveBooks()
    els.driveStatus.textContent = files.length ? '' : 'Sin libros en Drive.'
    for (const f of files) {
      const item = document.createElement('button')
      item.type = 'button'
      item.className = 'drive-item'
      item.textContent = f.name
      item.addEventListener('click', async () => {
        els.driveModal.hidden = true
        try {
          const record = (await library.listAll()).find(book => book.driveFileId === f.id)
            || await library.addOrTouch({ sourceType: 'drive', driveFileId: f.id, cloudAccountId: driveProfile?.id,
              name: f.name, title: normalizeBookTitle(f.name), mimeType: f.mimeType, size: Number(f.size) || 0,
              driveContentChecksum:f.md5Checksum || null }, { restoreRemoved:true })
          const file = await cloudSync.downloadForOffline(record)
          if (!file) return
          try { await cloudSync.syncBookProgress(record.id) }
          catch (error) { console.warn('No se pudo recuperar el progreso de Drive; se abrirá la copia descargada:', error) }
          const latest = await library.get(record.id)
          if (!latest) return
          await openFile(file, { existingRecord: latest, forcedId: latest.id, reuseStoredContent:true })
        } catch (error) { alert(`No se pudo abrir el libro: ${error.message}`) }
      })
      els.driveList.append(item)
    }
    syncLibraryToDrive({ silent: true }).catch(error => {
      setDriveSyncStatus(`No se pudo sincronizar: ${error.message}`)
      console.warn('No se pudieron sincronizar los libros pendientes:', error)
    })
  } catch (err) {
    if (err?.code === 'ANDROID_SHELL_OUTDATED' && await offerAvailableAndroidUpdate()) {
      els.driveModal.hidden = true
    } else {
      els.driveStatus.textContent = err?.code === 'ANDROID_SHELL_OUTDATED'
        ? 'Drive aún no está disponible en Android. Usa la web.'
        : `No se pudo conectar con Drive: ${err.message}`
    }
  }
}

// ---- Arranque ----

initTheme()
els.driveThemeToggle.checked = document.documentElement.getAttribute('data-theme') === 'dark'
els.appVersion.textContent = 'Inhouse Read · v1.7.35'
els.addDriveBtn.disabled = !isDriveConfigured()
els.addDriveBtn.title = isDriveConfigured() ? '' : 'Drive no disponible'
showScreen('home')
refreshShelf()
loadDriveAccountProfile().catch(error => console.warn('No se pudo restaurar la cuenta:', error))
initAndroidUpdateChecks()
initContentFreshnessChecks()
registerOfflineShell().catch(error => console.warn('No se pudo guardar la app para abrirla sin conexión:', error))
initReadingDisplay()
initAndroidFileImports({
  canImport: () => !closingReader && !els.readerScreen.classList.contains('is-preparing'),
  onFile: async file => {
    await shelf?.close()
    await progressWrites.get(currentBookId)?.catch(() => {})
    return new Promise((resolve, reject) => {
      openFile(file, { restoreRemoved:true, onImportReady:resolve }).then(resolve, reject)
    })
  },
  onError: error => alert(`No se pudo importar el libro: ${error.message}`)
})
if (hasDriveSession() || (getRememberedDriveProfile() && isAndroidShell())) {
  syncLibraryToDrive({ silent: true }).catch(error => setDriveSyncStatus(`No se pudo sincronizar: ${error.message}`))
}
function resumeDriveSync() {
  if (!navigator.onLine || (!hasDriveSession() && !getRememberedDriveProfile())) return
  syncLibraryToDrive({ silent: true }).catch(error => setDriveSyncStatus(`Sincronización pendiente: ${error.message}`))
}
globalThis.addEventListener('online', resumeDriveSync)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') resumeDriveSync()
})
