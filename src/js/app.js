import {bindShelfSoundPreference} from './cozy-sounds.js'
import { bookDataModule, withBookDataModule } from './book-data-native.js'
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
import { LiveRoom } from './live-room.js'
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
import { rememberLaunchFrames } from './shelf-launch-cache.js'
import { idleWork, shelfWorkReady, setShelfWorkActive } from './idle-startup.js'
import { runAfterFirstFrame } from './idle-startup.js'
import { loadRustCore, requireRustCore } from './rust-core.js'
import { loadRustDecorCore } from './rust-decor-core.js'
import { getRustShelf, needRustShelf, requireRustShelf } from './rust-shelf.js'
import { shelfBakesSettled } from './shelf-bake-cache.js'
import { loadPlantCatalogModule } from './plant-catalog-lazy.js'
import { classifyTapZone } from './gestures.js'
import { markTiming } from './perf-marks.js'
import { createPreparedPageCache, createStageGate, pageKeyMismatch } from './prepared-page.js'
import { createBookLengthQueue, isBookLengthReady } from './book-length-queue.js'
import { persistablePosition, persistableRelocation } from './readers/persistable-position.js'
import { readerReturnCanvas } from './reader-return-canvas.js'
import { createProfileView } from './profile-view.js'
import { createReadingStreak } from './reading-streak.js'
import { STREAK_KEY } from './reading-streak-core.js'
import { bindReadingFocus } from './reading-focus.js'

const reader = new ReaderController()
const profileView = createProfileView(document)
const releaseShelfSoundPreference=bindShelfSoundPreference(document)
// Android: sin notificaciones emergentes mientras el lector está abierto.
bindReadingFocus(document)
// Racha de lectura: cuenta el tiempo con un libro abierto (reading-streak.js).
const readingStreak = createReadingStreak({
  document, onChange: notifyCloudSettingsChanged,
  latestBook: () => library.listRecents(1).then(records => records[0] || null),
  bookTitle: record => normalizeBookTitle(record.title)
})

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
let shelfRefreshDeferred = false
let readerPreparationQueue = Promise.resolve()
// The page the open book lands on, prepared while the book is lifted off the
// shelf (see prepared-page.js and the 'Página preparada' block below).
const preparedPages = createPreparedPageCache()
let pageGate = null
const coverUpgrades = new Map()
const progressWrites = createReadingProgressQueue(library, {
  onSaved: (record, bookId, fields = []) => {
    if (!appDisposed && fields.includes('progressFraction')) readerPositionGuard().remember(bookId,{fraction:record?.progressFraction,locator:record?.locator})
    localRoomBookChanged(bookId, fields)
    if (record?.driveFileId && hasDriveSession()) cloudSync.scheduleProgress(bookId)
    scheduleLibraryBackup()
  }
})
let driveProfile = null
let savedReaderPositionGuard = null
const readerPositionGuard = () => savedReaderPositionGuard ||= new (bookDataModule().RustReaderPositionGuard)()
let restoringProgress = false
let lengthStatusVersion = 0
let shelfLengthStatusVersion = -1
let appDisposed = false
let drivePollTimer = null, drivePollGeneration = 0
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
let roomCaptureTimer = null
let roomCaptureBusy = false
let roomCaptureAgain = false
let roomCaptureFailures = 0
const liveRoom = new LiveRoom({
  enabled:()=>!appDisposed&&!document.hidden&&Boolean(driveProfile?.id),
  receive:(account,snapshot)=>libraryBackup.receiveSnapshot(account,snapshot),
  receiveMotion:(account,packet)=>{if(account===driveProfile?.id && els.readerScreen.hidden)shelf?.applyLiveRoomMotion?.(packet)},
  disconnected:source=>shelf?.clearLiveRoomMotion?.(source)
})
globalThis.addEventListener('inhouse-room-motion-local', e=>{
  if(driveProfile?.id)liveRoom.publishMotion(driveProfile.id,e.detail)
})
const libraryBackup = new LibraryBackup(library, cloudSync, {
  onStatus:setDriveSyncStatus,
  onChange:refreshShelf,
  onSnapshot:(account,device,snapshot) => { liveRoom.publish(account,snapshot).catch(()=>{}) },
  onLiveApplied:scheduleLibraryBackup,
  onSettings:applyCloudSettings
})
// The shell (theme, screens, reader controls, Drive picker, deferred refreshes) is
// rust-ui/src/app_shell.rs. Before the shelf module is in, its calls wait for it.
const withShell = use => { const ready = getRustShelf(); return ready ? use(ready) : requireRustShelf().then(use) }
function applyCloudSettings(keys) { return withShell(shell => shell.app_apply_cloud_settings(shellHost, keys)) }
const roomCoordinationHost = {
  hasDriveSession, getRememberedDriveProfile, syncLibraryToDrive,
  captureRoom: account => libraryBackup.captureRoom(account),
  drainLive: account => libraryBackup.drainLive(account),
  markBookChanged: (account,id,fields) => libraryBackup.markBookChanged(account,id,fields),
  backupCallback: () => withBookDataModule(module => module.app_backup_run(roomCoordinationHost)),
  captureCallback: () => withBookDataModule(module => module.app_room_capture_run(roomCoordinationHost)),
  backupFailure: error => setDriveSyncStatus(`Sincronización pendiente: ${error.message}`),
  warnRoom: error => console.warn('Colocación pendiente:', error.message),
  state: {
    get driveProfile(){return driveProfile},
    get backupTimer(){return backupTimer},set backupTimer(value){backupTimer=value},
    get roomCaptureTimer(){return roomCaptureTimer},set roomCaptureTimer(value){roomCaptureTimer=value},
    get roomCaptureBusy(){return roomCaptureBusy},set roomCaptureBusy(value){roomCaptureBusy=value},
    get roomCaptureAgain(){return roomCaptureAgain},set roomCaptureAgain(value){roomCaptureAgain=value},
    get roomCaptureFailures(){return roomCaptureFailures},set roomCaptureFailures(value){roomCaptureFailures=value}
  }
}
function scheduleLibraryBackup() {
  return withBookDataModule(module => module.app_backup_schedule(roomCoordinationHost))
}
function scheduleRoomCapture(delay = 32) {
  return withBookDataModule(module => module.app_room_capture_schedule(roomCoordinationHost,delay))
}
function localRoomBookChanged(id,fields) {
  return withBookDataModule(module => module.app_room_book_changed(roomCoordinationHost,id,fields))
}
globalThis.addEventListener('inhouse-room-book-changed',e=>localRoomBookChanged(e.detail?.id,e.detail?.fields||[]))
globalThis.addEventListener('inhouse-room-setting-changed', e => {
  if (driveProfile?.id && libraryBackup.markSettingChanged(driveProfile.id,e.detail)) scheduleRoomCapture()
})
globalThis.addEventListener('storage',e => {
  if (e.storageArea === localStorage && e.key?.startsWith('inhouse-read-shelf-')) applyCloudSettings([e.key])
})
globalThis.addEventListener('inhouse-library-changed', scheduleLibraryBackup)
function scheduleLengthRefresh() { return withShell(shell => shell.app_schedule_length_refresh(shellHost)) }
const wordCountQueue = createBookLengthQueue(library, {
  // The visible reader owns its own cached metrics. Detached library parsers
  // wait at page/section boundaries until Home is visible again.
  yieldTask:async () => {
    await new Promise(resolve => setTimeout(resolve, 0))
    await shelfWorkReady()
  },
  onChange: record => {
    if (appDisposed) return
    lengthStatusVersion += 1
    // Batch short books: rebuilding the shelf once per completed chapter or
    // library record would spend far more time drawing than counting text.
    scheduleLengthRefresh()
    if (record?.driveFileId && hasDriveSession()) { cloudSync.scheduleProgress(record.id); scheduleLibraryBackup() }
  },
  onError: error => console.warn('No se pudo contar el texto del libro:', error)
})
function persistBookState(bookId, fields) {
  return bookDataModule().app_persist_book_state(shelfRefreshHost, bookId, fields)
}

// The reading panel and voice code load after the shelf has settled (see the
// end of this file); a book never opens before they are in.
const readingExperience = createLazyReaderExperience(reader, {
  persist:persistBookState,
  async onLengthMetadata(record, metadata) {
    if (appDisposed) return
    // Reuse the visible reader's count rather than parsing this book again in
    // a detached worker. A replacement file must never inherit the old count.
    const revision = record.contentRevision
    const fields = { wordCount:metadata.wordCount, wordCountComplete:metadata.wordCountComplete,
      wordCountVersion:metadata.wordCountVersion, wordCountContentRevision:revision, lengthDirty:true }
    if (!revision || !isBookLengthReady({ ...record, ...fields })) return
    const saved = await library.patch(record.id, fields, {
      ifCurrent:current => Boolean(current?.content) && current.contentRevision === revision
    })
    if (!saved) return
    wordCountQueue.cancel(record.id)
    lengthStatusVersion += 1
    scheduleLengthRefresh()
    if (saved.driveFileId && hasDriveSession()) { cloudSync.scheduleProgress(saved.id); scheduleLibraryBackup() }
  }
})

const shellState = {
  lengthRefreshTimer:null, roomRefreshRetry:null, shelfRefreshQueued:false, readerLoadGeneration:0,
  get appDisposed() { return appDisposed }, get closingReader() { return closingReader },
  get shelfRefreshDeferred() { return shelfRefreshDeferred }, get shelf() { return shelf },
  get lengthStatusVersion() { return lengthStatusVersion }, get shelfLengthStatusVersion() { return shelfLengthStatusVersion },
  get cloudRoomChanged() { return cloudRoomChanged }, set cloudRoomChanged(value) { cloudRoomChanged = value },
  get pendingLocalReopenId() { return pendingLocalReopenId }, set pendingLocalReopenId(value) { pendingLocalReopenId = value },
  get pendingReaderTransition() { return pendingReaderTransition }, set pendingReaderTransition(value) { pendingReaderTransition = value },
  get driveProfile() { return driveProfile }
}
const shellHost = {
  els, document, reader, library, cloudSync, preparedPages, readingStreak, STREAK_KEY, APP_VERSION, state:shellState,
  authNotice:document.getElementById('drive-auth-notice'), authMessage:document.getElementById('drive-auth-message'),
  authRetry:document.getElementById('drive-auth-retry'), authCancel:document.getElementById('drive-auth-cancel'),
  get readingExperience() { return readingExperience },
  notifyCloudSettingsChanged, setShelfWorkActive, classifyTapZone, isDriveConfigured, refreshShelf, hasDriveSession,
  requestDriveAccess, loadDriveAccountProfile, listAllDriveBooks, syncLibraryToDrive, setDriveSyncStatus,
  offerAvailableAndroidUpdate, normalizeBookTitle, openFile,
  openFileContent: (file, options) => bookDataModule().app_open_file_content(fileContentHost, file, options)
}
els.themeToggle.addEventListener('click', () => withShell(shell => shell.app_set_theme(shellHost, 'toggle')))
function showScreen(name) { return withShell(shell => shell.app_show_screen(shellHost, name)) }

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
  readingStreak.destroy()
  nativeImportShelfGate.destroy()
  shelfRefreshQueue.dispose()
  clearTimeout(shellState.lengthRefreshTimer)
  shellState.lengthRefreshTimer = null
  wordCountQueue.dispose()
  clearTimeout(backupTimer)
  if (drivePollTimer !== null) bookDataModule().app_drive_poll_update(driveActionsHost)
  clearTimeout(roomCaptureTimer)
  savedReaderPositionGuard?.free(); savedReaderPositionGuard = null
  clearTimeout(shellState.roomRefreshRetry)
  liveRoom.destroy()
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

const retryRoomRefresh = () => needRustShelf().app_retry_room_refresh(shellHost)
async function performShelfRefresh({ immediate = false } = {}) {
  const firstRecords = takeFirstRawRecords()
  // A native import changes the library after the boot snapshot was taken.
  // Discard that one-shot snapshot even when its room is deferred, so returning
  // from the reader fetches the newly committed book instead of an empty shelf.
  if (appDisposed || nativeImportShelfGate.deferRefresh()) return
  // Sync may keep receiving records while reading. Retain that notification;
  // do not reread every cover/blob or rebuild hidden shelf geometry for it.
  if (!els.readerScreen.hidden) { shelfRefreshDeferred = true; return }
  shelfRefreshDeferred = false
  // Re-rendering a shelf closes its current 3D cover. Defer background
  // changes until the reader transition or close has finished.
  if (document.querySelector('.ihr-flyout')) return void needRustShelf().app_refresh_after_flyout(shellHost)
  if (shelf?.isInteracting) { retryRoomRefresh(); return }
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
  const result = await needRustShelf().app_refresh_after_load(shelfRefreshHost, storedBooks, accountId, immediate)
  if (shelf?.isInteracting) retryRoomRefresh()
  return result
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
  scheduleLibraryBackup, releasePageGate, onLocalBookChange:localRoomBookChanged,
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

function setReaderChromeHidden(hidden) { return needRustShelf().app_set_reader_chrome_hidden(shellHost, hidden) }


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
els.addDriveBtn.addEventListener('click', () => withShell(shell => shell.app_open_drive_modal(shellHost)))
els.filePicker.addEventListener('change', () => withShell(shell => shell.app_file_picked(shellHost)))

// ---- Apertura y lectura ----

function openFile(file, options = {}) { return withShell(shell => shell.app_open_file(shellHost, file, options)) }
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
  get positionGuard() { return readerPositionGuard() },
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

async function revealPreparedReader() {
  showScreen('reader')
  els.readerScreen.classList.remove('is-preparing')
}

const driveActionsHost = {
  els, document, console, library, cloudSync, liveRoom, libraryBackup, profileView,
  hasDriveSession, requestDriveAccess, getDriveProfile, getRememberedDriveProfile,
  isAndroidShell, restoreLegacyBookBytes, offerAvailableAndroidUpdate,
  showAuthNotice, closeProfileMenu, setDriveSyncStatus, signOutDrive, cancelDriveConnection, refreshShelf,
  online: () => navigator.onLine,
  armDrivePoll: (generation, delay) => setTimeout(() => bookDataModule().app_drive_poll_tick(driveActionsHost, generation), delay),
  cancelDrivePoll: timer => clearTimeout(timer),
  pollDrive: () => bookDataModule().app_drive_resume(driveActionsHost, { poll:true }),
  uploadProgressFailure: error => bookDataModule().app_drive_upload_progress_failure(driveActionsHost,error),
  authFailure: reportDriveConnectionError,
  resumeReady: () => bookDataModule().app_drive_resume_ready(driveActionsHost),
  resumeFailure: error => bookDataModule().app_drive_resume_failure(driveActionsHost,error),
  savedCheckMarkup:'<svg class="ihr-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false"><path d="m5 12 4 4L19 6"/></svg>',
  state: {
    get driveProfile(){return driveProfile}, set driveProfile(value){driveProfile=value; syncDrivePoll()},
    get appDisposed(){return appDisposed},
    get drivePollTimer(){return drivePollTimer}, set drivePollTimer(value){drivePollTimer=value},
    get drivePollGeneration(){return drivePollGeneration}, set drivePollGeneration(value){drivePollGeneration=value},
    get cloudRoomChanged(){return cloudRoomChanged},
    get driveUploadsInFlight(){return driveUploadsInFlight}, set driveUploadsInFlight(value){driveUploadsInFlight=value}
  }
}

function handleCoverAction(action, book, button) {
  return withBookDataModule(module => module.app_drive_cover_action(driveActionsHost, action, book, button))
}

function setDriveSyncStatus(message, syncing = false) {
  profileView.syncStatus(message, syncing)
}

function loadDriveAccountProfile() {
  return withBookDataModule(module => module.app_drive_load_profile(driveActionsHost))
}

function syncLibraryToDrive(options = {}) {
  return withBookDataModule(module => module.app_drive_sync(driveActionsHost, options))
}

function showAuthNotice(message, options) { return withShell(shell => shell.app_show_auth_notice(shellHost, message, options)) }

function connectGoogleAccount() {
  return withBookDataModule(module => module.app_drive_connect(driveActionsHost))
}

els.driveConnectBtn.addEventListener('click', connectGoogleAccount)
shellHost.authRetry.addEventListener('click', connectGoogleAccount)
shellHost.authCancel.addEventListener('click', () => withBookDataModule(module => module.app_drive_cancel(driveActionsHost)))
document.getElementById('drive-auth-dismiss').addEventListener('click', () => { shellHost.authNotice.hidden = true })
globalThis.addEventListener('inhouse-drive-auth', event => withBookDataModule(module => module.app_drive_auth_event(driveActionsHost,event.detail)))

function reportDriveConnectionError(error) {
  return withBookDataModule(module => module.app_drive_report_error(driveActionsHost, error))
}

els.driveThemeToggle.addEventListener('change', () => withShell(shell => shell.app_set_theme(shellHost, 'switch')))

function closeProfileMenu() {
  profileView.closeMenu()
}
profileView.connect(closeAndroidUpdateSettings, els.driveThemeToggle)
els.driveSyncBtn.addEventListener('click', () => withBookDataModule(module => module.app_drive_manual_sync(driveActionsHost)))
els.driveSignOutBtn.addEventListener('click', () => withBookDataModule(module => module.app_drive_sign_out(driveActionsHost)))
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
  get positionGuard() { return readerPositionGuard() },
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
    get shelfRefreshDeferred() { return shelfRefreshDeferred },
    get cloudRoomChanged() { return cloudRoomChanged }, get shelf() { return shelf }
  }
}
els.readerBack.addEventListener('click', () => bookDataModule().app_close_reader(readerCloseHost))

els.readerPrev.addEventListener('click', () => readingExperience.step(-1))
els.readerNext.addEventListener('click', () => readingExperience.step(1))

// ---- Google Drive ----

els.driveClose.addEventListener('click', () => { els.driveModal.hidden = true })

// ---- Arranque ----

withShell(shell => {
  shell.app_start_shell(shellHost)
  shell.app_watch_reader_controls(shellHost)
  shell.app_watch_prepared_pages(shellHost)
})
// A newer deploy found at launch reloads only a shelf nobody is using yet.
deployCheck = initContentFreshnessChecks({ isIdle: () => !closingReader && !driveUploadsInFlight && !shellState.shelfRefreshQueued && !shelf?.isInteracting &&
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
  () => rememberLaunchFrames(els.bookshelfRoot, { books:() => library.listRaw(), idle:idleWork,
    isIdle:() => !appDisposed && els.readerScreen.hidden && !shelf?.isInteracting && !closingReader }),
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
function resumeDriveSync(options = {}) {
  return withBookDataModule(module => {
    module.app_drive_poll_update(driveActionsHost)
    return module.app_drive_resume(driveActionsHost,options)
  })
}
function syncDrivePoll() {
  const pending = withBookDataModule(module => module.app_drive_poll_update(driveActionsHost))
  // Polling is optional while the already-started shelf module is loading.
  // A failed bootstrap is reported by the foreground shelf path.
  pending?.catch?.(() => {})
  return pending
}
globalThis.addEventListener('online', resumeDriveSync)
globalThis.addEventListener('offline', syncDrivePoll)
syncDrivePoll()
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') resumeDriveSync()
  else { liveRoom.suspend(); syncDrivePoll() }
})
globalThis.addEventListener('pageshow', () => { if (!document.hidden) resumeDriveSync() })
