import {bindShelfSoundPreference} from './cozy-sounds.js'
import { bookDataModule } from './book-data-native.js'
import { library, takeFirstRawRecords } from './shelf-boot.js'
import { version as APP_VERSION } from '../../package.json'
import { libraryHost, recentFirst } from './library-store.js'
import { createReadingProgressQueue } from './reading-progress-queue.js'
import { bookCloudState, isBookVisible, storeBookFile, needsDriveDownload } from './book-storage-policy.js'
import { refreshSelectedBookNames } from './selected-book-names.js'
import { renderBookshelf } from './bookshelf.js'
import { ReaderController, UnsupportedFormatError } from './readers/reader-controller.js'
import {
  isDriveConfigured, requestDriveAccess, listAllDriveBooks, hasDriveSession,
  getDriveProfile, getRememberedDriveProfile, signOutDrive, cancelDriveConnection
} from './drive-client.js'
import { CloudSync } from './cloud-sync.js'
import { LibraryBackup } from './library-backup.js'
import { notifyCloudSettingsChanged } from './cloud-settings.js'
import { createShelfRefreshQueue } from './shelf-refresh-queue.js'
import { restoreLegacyBookBytes } from './legacy-book-recovery.js'
import {
  isFolderApiSupported, getSavedFolderHandle, ensureFolderPermission, readFileFromFolder
} from './local-folder-store.js'
import { initAndroidUpdateChecks, offerAvailableAndroidUpdate, closeAndroidUpdateSettings } from './android-update.js'
import { initContentFreshnessChecks } from './content-freshness.js'
import { registerOfflineShell } from './offline-shell.js'
import { initAndroidFileImports } from './android-file-import.js'
import { createNativeImportShelfGate } from './native-import-shelf-gate.js'
import { initReadingDisplay } from './reading-display.js'
import { normalizeBookAuthor, normalizeBookTitle } from './book-title.js'
import { createLazyReaderExperience } from './readers/reader-experience-lazy.js'
import { runAfterFirstFrame } from './idle-startup.js'
import { loadRustCore, requireRustCore } from './rust-core.js'
import { loadRustDecorCore } from './rust-decor-core.js'
import { needRustShelf, requireRustShelf } from './rust-shelf.js'
import { shelfBakesSettled } from './shelf-bake-cache.js'
import { loadPlantCatalogModule } from './plant-catalog-lazy.js'
import { classifyTapZone, ZONE } from './gestures.js'
import { markTiming } from './perf-marks.js'
import { createPreparedPageCache, createStageGate, pageKeyMismatch } from './prepared-page.js'
import { createBookLengthQueue, isBookLengthReady } from './book-length-queue.js'
import { persistablePosition, persistableRelocation } from './readers/persistable-position.js'
import { readerReturnCanvas } from './reader-return-canvas.js'
import { createProfileView } from './profile-view.js'

const reader = new ReaderController()
const profileView = createProfileView(document)
const releaseShelfSoundPreference=bindShelfSoundPreference(document)

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
const progressWrites = createReadingProgressQueue(library, {
  onSaved: (record, bookId) => {
    if (record?.driveFileId && hasDriveSession()) cloudSync.scheduleProgress(bookId)
    scheduleLibraryBackup()
  }
})
let driveProfile = null
let restoringProgress = false
let shelfRefreshQueued = false
let lengthStatusVersion = 0
let shelfLengthStatusVersion = -1
let lengthRefreshTimer = null
let appDisposed = false
let deployCheck = null
const shelfRefreshQueue = createShelfRefreshQueue({ perform:performShelfRefresh })
const nativeImportShelfGate = createNativeImportShelfGate({
  isReaderVisible: () => !els.readerScreen.hidden,
  refresh: () => refreshShelf()
})
let driveUploadsInFlight = 0
const cloudSync = new CloudSync(library, {
  onStatus: setDriveSyncStatus,
  onChange: record => { if (record) shelf?.updateCloudRecord?.(record); return refreshShelf() }
})
let cloudRoomChanged = false
let backupTimer = null
const libraryBackup = new LibraryBackup(library, cloudSync, {
  onStatus:setDriveSyncStatus,
  onChange:refreshShelf,
  onSettings:() => {
    cloudRoomChanged = true
    initTheme()
    readingExperience.reloadPreferences()
    refreshShelf()
  }
})
function scheduleLibraryBackup() {
  clearTimeout(backupTimer)
  if (!hasDriveSession() && !getRememberedDriveProfile()) return
  backupTimer = setTimeout(() => {
    backupTimer = null
    syncLibraryToDrive({ silent:true }).catch(error => setDriveSyncStatus(`Sincronización pendiente: ${error.message}`))
  }, 2200)
}
globalThis.addEventListener('inhouse-library-changed', scheduleLibraryBackup)
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
function persistBookState(bookId, fields) {
  return bookDataModule().app_persist_book_state(shelfRefreshHost, bookId, fields)
}

// The reading panel and voice code load after the shelf has settled (see the
// end of this file); a book never opens before they are in.
const readingExperience = createLazyReaderExperience(reader, { persist:persistBookState })

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
  notifyCloudSettingsChanged('inhouse-read-theme')
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
  profileView.destroy()
  releaseShelfSoundPreference()
  nativeImportShelfGate.destroy()
  shelfRefreshQueue.dispose()
  clearTimeout(lengthRefreshTimer)
  lengthRefreshTimer = null
  wordCountQueue.dispose()
  clearTimeout(backupTimer)
  clearInterval(backupPoll)
})

function isAndroidShell() {
  return /\bInhouseReadApp\/\d/i.test(navigator.userAgent || '')
}

// ---- Home / estantería ----
// Contrato de renderBookshelf(container, books, options) documentado en el
// propio src/js/bookshelf.js (cabecera del archivo).

function refreshShelf(options) {
  return shelfRefreshQueue.request(options)
}

async function performShelfRefresh({ immediate = false } = {}) {
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
  return needRustShelf().app_refresh_after_load(shelfRefreshHost, storedBooks, accountId, immediate)
}

function createShelfForRecords(books) {
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
      onShelfPlacementChange: options => bookDataModule().app_placement_changed(shelfRefreshHost, options),
      onBookOrderChange: order => bookDataModule().app_order_changed(shelfRefreshHost, order)
    })
}

const shelfRefreshHost = {
  library, libraryHost, nativeImportShelfGate, els, wordCountQueue,
  progressWrites, preparedBooks, coverUpgrades, cloudSync, preparedPages, reader,
  get readingExperience() { return readingExperience },
  scheduleLibraryBackup, releasePageGate,
  ignoreRemovalPreparationError: () => {},
  removedPreparationCleanup: (book, generation) => () => bookDataModule().app_finish_removed_preparation(shelfRefreshHost, book, generation),
  warnRemovalPreparation: error => console.warn('No se pudo liberar la preparación del libro retirado:', error),
  createShelf: createShelfForRecords,
  placementMapper: () => row => bookDataModule().app_placement_record(shelfRefreshHost, row),
  orderMapper: () => row => bookDataModule().app_order_record(shelfRefreshHost, row),
  warnPreparation: error => console.warn('Preparación del grosor:', error),
  state: {
    get appDisposed() { return appDisposed },
    get requestedPreparationId() { return requestedPreparationId }, set requestedPreparationId(value) { requestedPreparationId = value },
    get activePreparedBookId() { return activePreparedBookId }, set activePreparedBookId(value) { activePreparedBookId = value },
    get preparationGeneration() { return preparationGeneration }, set preparationGeneration(value) { preparationGeneration = value },
    get readerPreparationQueue() { return readerPreparationQueue },
    get currentBookId() { return currentBookId }, set currentBookId(value) { currentBookId = value },
    get closingReader() { return closingReader },
    get cloudRoomChanged() { return cloudRoomChanged }, set cloudRoomChanged(value) { cloudRoomChanged = value },
    get shelf() { return shelf }, set shelf(value) { shelf = value },
    get shelfRecords() { return shelfRecords }, set shelfRecords(value) { shelfRecords = value },
    get lengthStatusVersion() { return lengthStatusVersion },
    get shelfLengthStatusVersion() { return shelfLengthStatusVersion }, set shelfLengthStatusVersion(value) { shelfLengthStatusVersion = value }
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


function animateReaderPageFromBook(options) {
  return bookDataModule().app_animate_reader_page(readerOpeningHost, options)
}
function openBookRecord(book, ctx) {
  return bookDataModule().app_open_book_record(readerOpeningHost, book, ctx)
}
// Browser callback objects are GC-owned; all opening decisions run in Rust.
const readerOpeningHost = {
  els, preparedBooks, readingExperience, library, cloudSync, document, window, console,
  refreshSelectedBookNames, revealPreparedReader, markTiming, openingPageSnapshot,
  animateReaderPageFromBook, releasePageGate, extractCoverInBackground, showScreen,
  needsDriveDownload, openFile, isFolderApiSupported, getSavedFolderHandle,
  ensureFolderPermission, readFileFromFolder,
  requestAnimationFrame: callback => requestAnimationFrame(callback),
  setTimeout: (callback, delay) => setTimeout(callback, delay),
  alert: message => alert(message),
  readerPageFrames: () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  openingCallbacks: flight => ({
    isActive: () => bookDataModule().app_opening_is_active(flight),
    onReaderReady: () => bookDataModule().app_reader_ready(readerOpeningHost, flight),
    onReaderError: () => bookDataModule().app_close_reader_opening(readerOpeningHost, flight)
  }),
  openingCancellation: flight => () => bookDataModule().app_cancel_reader_opening(readerOpeningHost, flight),
  revealReaderToolbar: () => bookDataModule().app_reveal_reader_toolbar(readerOpeningHost),
  settleReaderToolbar: () => bookDataModule().app_settle_reader_toolbar(readerOpeningHost),
  pickerCancellation: flight => () => bookDataModule().app_cancel_opening_picker(readerOpeningHost, flight),
  filePickerFocusListener: flight => function onFocusBack() {
    window.removeEventListener('focus', onFocusBack)
    bookDataModule().app_schedule_picker_cancel(readerOpeningHost, flight)
  },
  state: {
    get activeOpeningContext() { return activeOpeningContext }, set activeOpeningContext(value) { activeOpeningContext = value },
    get pendingLocalReopenId() { return pendingLocalReopenId }, set pendingLocalReopenId(value) { pendingLocalReopenId = value },
    get pendingReaderTransition() { return pendingReaderTransition }, set pendingReaderTransition(value) { pendingReaderTransition = value },
    get currentBookId() { return currentBookId }, get activePreparedBookId() { return activePreparedBookId }
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
  // A failed native download must remain reportable before Rust exists.
  try { await readingExperience.ready() }
  catch (error) { throw new Error('No se pudo cargar el lector. Comprueba la conexión e inténtalo de nuevo.', { cause:error }) }
  return bookDataModule().app_open_file_content(fileContentHost, file, {
    existingRecord, forcedId, folderFileName, transition, preparing,
    restoreRemoved, onImportReady, reuseStoredContent
  })
}
const fileContentHost = {
  els, readingExperience, reader, library, wordCountQueue, preparedBooks, document, console,
  supersedePreparation, showScreen, storeBookFile, normalizeBookTitle, normalizeBookAuthor,
  scheduleLibraryBackup, refreshShelf, extractCoverInBackground, onReaderRelocate, setReaderChromeHidden,
  alert: message => alert(message), isUnsupportedFormatError: error => error instanceof UnsupportedFormatError,
  ignoreFileOpenError: () => {}, warnFileGeometry: error => console.warn('No se pudo medir el libro:', error),
  fileReaderCallbacks: () => ({
    onUserNavigation: () => bookDataModule().app_reader_user_navigation(fileContentHost),
    onFollowLink: href => bookDataModule().app_reader_follow_link(fileContentHost, href),
    onToggleChrome: () => bookDataModule().app_reader_toggle_chrome(fileContentHost)
  }),
  state: {
    get readerPreparationQueue() { return readerPreparationQueue },
    get requestedPreparationId() { return requestedPreparationId }, set requestedPreparationId(value) { requestedPreparationId = value },
    get activePreparedBookId() { return activePreparedBookId }, set activePreparedBookId(value) { activePreparedBookId = value },
    get currentBookId() { return currentBookId }, set currentBookId(value) { currentBookId = value },
    get restoringProgress() { return restoringProgress }, set restoringProgress(value) { restoringProgress = value }
  }
}

function prepareBookOpen(book, { settled } = {}) {
  return bookDataModule().app_prepare_book(readerPreparationHost, book, settled)
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

// Rust owns preparation generations and cache decisions. These factories only
// adapt Promise callbacks; browser idle work and DOM measurements keep their APIs.
const readerPreparationHost = {
  library, preparedBooks, preparedPages, progressWrites, reader, els, window, document,
  get readingExperience() { return readingExperience },
  get cloudSync() { return cloudSync },
  state: {
    get preparationGeneration() { return preparationGeneration }, set preparationGeneration(value) { preparationGeneration = value },
    get requestedPreparationId() { return requestedPreparationId }, set requestedPreparationId(value) { requestedPreparationId = value },
    get activePreparedBookId() { return activePreparedBookId }, set activePreparedBookId(value) { activePreparedBookId = value },
    get currentBookId() { return currentBookId },
    get readerPreparationQueue() { return readerPreparationQueue }, set readerPreparationQueue(value) { readerPreparationQueue = value },
    get restoringProgress() { return restoringProgress }, set restoringProgress(value) { restoringProgress = value },
    get pageGate() { return pageGate }, set pageGate(value) { pageGate = value },
    get shelf() { return shelf }
  },
  needsDriveDownload, hasDriveSession, openFile, markTiming, pageKeyMismatch, idleSlice,
  getComputedStyle: element => getComputedStyle(element),
  createStageGate: settled => createStageGate(settled, { idle:idleSlice }),
  ignorePreparationError: () => {},
  warnPagePreparation: error => console.warn('No se pudo preparar la página guardada de antemano:', error),
  reprepareRunner: (book, generation, gate) => ready => bookDataModule().app_reprepare_page(readerPreparationHost, book, generation, gate, ready),
  preparationRunner: (book, generation, gate, files) => () => bookDataModule().app_run_preparation(readerPreparationHost, book, generation, gate, files)
}

function releasePageGate(reason, bookId) {
  return bookDataModule().app_release_page_gate(readerPreparationHost, reason, bookId)
}
function supersedePreparation(reason) {
  return bookDataModule().app_supersede_preparation(readerPreparationHost, reason)
}
function dismissPreparedPage() {
  return bookDataModule().app_dismiss_prepared_page(readerPreparationHost)
}
async function openingPageSnapshot(bookId, record) {
  return bookDataModule().app_opening_page_snapshot(readerPreparationHost, bookId, record)
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
  // step, each with its own wording so the short one never truncates. An
  // icon-only button keeps its icon and says it in its accessible name.
  const labels = button.classList.contains('ihr-btn--icon') ? []
    : button.querySelectorAll('span').length ? [...button.querySelectorAll('span')] : [button]
  const originals = labels.map(label => label.textContent)
  const originalAria = button.getAttribute('aria-label')
  const setLabel = (text, short = text) => {
    labels.forEach(label => { label.textContent = label.classList.contains('ihr-btn__label--short') ? short : text })
    button.setAttribute('aria-label', text)
    if (button.classList.contains('ihr-btn--icon')) button.title = text
  }
  const restoreLabel = () => {
    labels.forEach((label, index) => { label.textContent = originals[index] })
    if (originalAria) button.setAttribute('aria-label', originalAria)
    else button.removeAttribute('aria-label')
    if (originalAria && button.classList.contains('ihr-btn--icon')) button.title = originalAria
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
      if (book.driveFileId) {
        await cloudSync.downloadForOffline(book)
      } else throw new Error('Este libro ya tiene su copia en el dispositivo.')
      setLabel('Disponible offline', 'Offline')
      saved = true
    } else if (action === 'drive') {
      if (!hasDriveSession()) throw new Error('Conecta tu cuenta de Google para subir este libro.')
      const updated = await uploadBookToDrive(book)
      if (!updated) return
      Object.assign(book, updated)
      // The same discreet Drive mark, with a small tick.
      const status = document.createElement('span')
      status.className = 'ihr-btn ihr-btn--quiet ihr-btn--icon ihr-flyout__cloud-saved'
      status.setAttribute('role', 'status')
      status.setAttribute('aria-label', 'Guardado en Google Drive')
      status.title = 'Guardado en Google Drive'
      const icon = button.querySelector('svg')?.cloneNode(true)
      if (icon) status.append(icon)
      const check = document.createElement('span')
      check.className = 'ihr-flyout__cloud-check'
      check.setAttribute('aria-hidden', 'true')
      check.innerHTML = '<svg class="ihr-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false"><path d="m5 12 4 4L19 6"/></svg>'
      status.append(check)
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
  profileView.syncStatus(message, syncing)
}

async function loadDriveAccountProfile() {
  if (!hasDriveSession()) {
    driveProfile = null
    cloudSync.reset()
    libraryBackup.reset()
    profileView.visibility(false)
    profileView.localAccount()
    return null
  }
  profileView.visibility(true)
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
  profileView.account(driveProfile)
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
  return libraryBackup.sync(profile.id)
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
  closeProfileMenu()
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
  notifyCloudSettingsChanged('inhouse-read-theme')
})

function closeProfileMenu() {
  profileView.closeMenu()
}
profileView.connect(closeAndroidUpdateSettings, els.driveThemeToggle)
els.driveSyncBtn.addEventListener('click', async () => {
  els.driveSyncBtn.disabled = true
  try { await syncLibraryToDrive() }
  catch (error) { setDriveSyncStatus(`No se pudo sincronizar: ${error.message}`) }
  finally { els.driveSyncBtn.disabled = false }
})
els.driveSignOutBtn.addEventListener('click', () => {
  signOutDrive()
  cloudSync.reset()
  libraryBackup.reset()
  driveProfile = null
  closeProfileMenu()
  loadDriveAccountProfile()
  showAuthNotice('')
  els.driveProfileBtn.setAttribute('aria-expanded', 'false')
  refreshShelf()
})
/** No bloquea la apertura del libro: la portada se guarda para la próxima visita a la estantería. */
function extractCoverInBackground(record) {
  return bookDataModule().app_extract_cover_background(coverBackgroundHost, record)
}
const coverBackgroundHost = {
  reader, coverUpgrades, library, refreshShelf, scheduleLibraryBackup, global:globalThis, console,
  now: () => Date.now(),
  measureSmallCover: bitmap => bookDataModule().app_cover_bitmap_small(bitmap),
  coverBitmapFailed: () => bookDataModule().app_cover_bitmap_failed(),
  coverPatchGuard: flight => latest => bookDataModule().app_cover_patch_allowed(coverBackgroundHost, flight, latest),
  coverFlowCallbacks: flight => ({
    fetch: needed => bookDataModule().app_cover_fetch(coverBackgroundHost, flight, needed),
    persist: blob => bookDataModule().app_cover_persist(coverBackgroundHost, flight, blob),
    updated: record => bookDataModule().app_cover_updated(coverBackgroundHost, flight, record),
    failed: error => bookDataModule().app_cover_failed(coverBackgroundHost, flight, error),
    finish: () => bookDataModule().app_cover_finished(coverBackgroundHost, flight)
  }),
  state: {
    get appDisposed() { return appDisposed }, get closingReader() { return closingReader },
    get currentBookId() { return currentBookId }
  }
}

function onReaderRelocate({ fraction, cfi, index, textOffset }) {
  return bookDataModule().app_reader_relocate(readerRuntimeHost, { fraction, cfi, index, textOffset })
}
const readerRuntimeHost = {
  els, readingExperience, reader, progressWrites,
  warnReaderProgress: error => console.warn('No se pudo guardar el progreso:', error),
  state: {
    get currentBookId() { return currentBookId }, get restoringProgress() { return restoringProgress },
    get closingReader() { return closingReader }
  }
}

// JS owns callback lifetimes; the close/return sequence and cleanup run in Rust.
const readerCloseHost = {
  reader, readingExperience, els, coverUpgrades, progressWrites, library, cloudSync, preparedBooks,
  document, console, matchMedia: query => matchMedia(query), getComputedStyle: node => getComputedStyle(node),
  persistablePosition, readerReturnCanvas, supersedePreparation, hasDriveSession,
  isBookLengthReady, showScreen, refreshShelf, setDriveSyncStatus,
  ignoreCloseError: () => {},
  closeHandoff: flight => () => bookDataModule().app_return_page_handoff(readerCloseHost, flight),
  closeStillRemoval: flight => () => bookDataModule().app_remove_return_page(flight),
  closeProgressFlush: id => () => bookDataModule().app_flush_closed_progress(readerCloseHost, id),
  warnClosedProgress: error => bookDataModule().app_warn_closed_progress(readerCloseHost, error),
  warnPendingShelf: error => console.warn('Estantería pendiente:', error),
  state: {
    get currentBookId() { return currentBookId }, set currentBookId(value) { currentBookId = value },
    get closingReader() { return closingReader }, set closingReader(value) { closingReader = value },
    get requestedPreparationId() { return requestedPreparationId }, set requestedPreparationId(value) { requestedPreparationId = value },
    get activePreparedBookId() { return activePreparedBookId }, set activePreparedBookId(value) { activePreparedBookId = value },
    get cloudRoomChanged() { return cloudRoomChanged }, get shelf() { return shelf }
  }
}
els.readerBack.addEventListener('click', () => bookDataModule().app_close_reader(readerCloseHost))

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
// The published version, from package.json: it changes with every release.
els.appVersion.textContent = `Inhouse Read · v${APP_VERSION}`
els.addDriveBtn.disabled = !isDriveConfigured()
els.addDriveBtn.title = isDriveConfigured() ? '' : 'Drive no disponible'
showScreen('home')
// A newer deploy found at launch reloads only a shelf nobody is using yet.
deployCheck = initContentFreshnessChecks({ isIdle: () => !closingReader && !driveUploadsInFlight && !shelfRefreshQueued &&
  !document.querySelector('.ihr-flyout') && els.readerScreen.hidden && els.driveModal.hidden &&
  document.getElementById('drive-auth-notice').hidden })
refreshShelf({ immediate:true })
loadDriveAccountProfile().catch(error => console.warn('No se pudo restaurar la cuenta:', error))
initAndroidUpdateChecks()
// Everything below waits for the first live shelf frame, one task per idle
// slice: the offline-shell download must not compete with the shelf's own
// files, and the reader / catalogue chunks are loaded before anyone reaches
// for them (see idle-startup.js).
runAfterFirstFrame([
  () => { void loadRustCore(); void loadRustDecorCore(); profileView.warm() }, // reuse early instance, or bounded recovery after a failure
  () => readingExperience.prefetch(),
  () => loadPlantCatalogModule().catch(() => {}),
  () => registerOfflineShell().catch(error => console.warn('No se pudo guardar la app para abrirla sin conexión:', error))
])
initReadingDisplay()
initAndroidFileImports({
  onActivity: active => nativeImportShelfGate.setActive(active),
  canImport: () => !closingReader && !els.readerScreen.classList.contains('is-preparing'),
  onFile: async file => {
    await shelf?.close()
    await progressWrites.get(currentBookId)?.catch(() => {})
    // Resolve the import after the loading wrapper has released its controls.
    // Its successful result already guarantees committed original bytes.
    return openFile(file, { restoreRemoved:true })
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
const backupPoll = setInterval(() => {
  if (!document.hidden && !libraryBackup.task) resumeDriveSync()
}, 180_000)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') resumeDriveSync()
})
