import { LibraryStore } from './library-store.js'
import { renderBookshelf } from './bookshelf.js'
import { ReaderController, UnsupportedFormatError } from './readers/reader-controller.js'
import {
  isDriveConfigured, requestDriveAccess, listAllDriveBooks, hasDriveSession,
  getDriveProfile, getRememberedDriveProfile, signOutDrive, cancelDriveConnection
} from './drive-client.js'
import { CloudSync } from './cloud-sync.js'
import { restoreLegacyBookBytes } from './legacy-book-recovery.js'
import {
  isFolderApiSupported, getSavedFolderHandle, getOrChooseFolder, ensureFolderPermission,
  saveFileIntoFolder, readFileFromFolder
} from './local-folder-store.js'
import { initAndroidUpdateChecks, offerAvailableAndroidUpdate } from './android-update.js'
import { initContentFreshnessChecks } from './content-freshness.js'
import { normalizeBookAuthor, normalizeBookTitle } from './book-title.js'
import { ReaderExperience } from './readers/reader-experience.js'

const library = new LibraryStore()
const reader = new ReaderController()

const els = {
  homeScreen: document.getElementById('home-screen'),
  readerScreen: document.getElementById('reader-screen'),
  bookshelfRoot: document.getElementById('bookshelf-root'),
  readerViewport: document.getElementById('reader-viewport'),
  readerToolbar: document.getElementById('reader-toolbar'),
  readerBack: document.getElementById('reader-back'),
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
let currentBookId = null
let pendingLocalReopenId = null
let pendingReaderTransition = null
const preparedBooks = new Map()
const coverUpgrades = new Map()
const progressWrites = new Map()
let driveProfile = null
let restoringProgress = false
let shelfRefreshQueued = false
let driveUploadsInFlight = 0
const cloudSync = new CloudSync(library, {
  onStatus: setDriveSyncStatus,
  onChange: refreshShelf
})
async function persistBookState(bookId, fields) {
  const previous = progressWrites.get(bookId) || Promise.resolve()
  const write = previous.catch(() => {}).then(() => library.patch(bookId, {
    ...fields, progressUpdatedAt:Date.now(), progressDirty:true
  })).then(() => { if (hasDriveSession()) cloudSync.scheduleProgress(bookId) })
  progressWrites.set(bookId, write)
  try { await write } finally { if (progressWrites.get(bookId) === write) progressWrites.delete(bookId) }
}
const readingExperience = new ReaderExperience(reader, { persist:persistBookState })

// ---- Tema (idéntico al patrón de Inhouse Notes: data-theme + persistido) ----

function initTheme() {
  const saved = localStorage.getItem('inhouse-read-theme')
  const preferred = saved ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
  document.documentElement.setAttribute('data-theme', preferred)
}

els.themeToggle.addEventListener('click', () => {
  const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'
  document.documentElement.setAttribute('data-theme', next)
  localStorage.setItem('inhouse-read-theme', next)
  if (els.driveThemeToggle) els.driveThemeToggle.checked = next === 'dark'
})

// ---- Navegación entre pantallas ----

function showScreen(name) {
  document.body.classList.toggle('is-reading', name === 'reader')
  els.homeScreen.hidden = name !== 'home'
  els.readerScreen.hidden = name !== 'reader'
}

function isAndroidShell() {
  return /\bInhouseReadApp\/\d/i.test(navigator.userAgent || '')
}

// ---- Home / estantería ----
// Contrato de renderBookshelf(container, books, options) documentado en el
// propio src/js/bookshelf.js (cabecera del archivo).

async function refreshShelf() {
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
  const normalizedBooks = await Promise.all(storedBooks.map(book => {
    const title = normalizeBookTitle(book.title || book.name)
    const author = normalizeBookAuthor(book.author)
    const patch = {}
    if (title !== book.title) patch.title = title
    if (author !== (book.author || '')) patch.author = author || null
    return Object.keys(patch).length ? library.patch(book.id, patch) : book
  }))
  const books = normalizedBooks.filter(book =>
    book.sourceType !== 'drive' || (accountId && (!book.cloudAccountId || book.cloudAccountId === accountId))
  )
  if (!shelf) {
    shelf = renderBookshelf(els.bookshelfRoot, books, {
      onBookOpen: openBookRecord,
      onPrepareBook: prepareBookOpen,
      getBookPreparation: book => preparedBooks.get(book.id),
      onBookAction: handleCoverAction,
      onAddBooks: pickLocalFile,
      coverSrcFor: book => book.cover ?? null,
      waitForCoverAppearance: true,
      onCoverAppearance: (book, appearance, key) => library.patch(book.id, {
        coverAppearance: appearance,
        coverAppearanceKey: key
      }),
      onBookCustomizationChange: (book, fields) => persistBookState(book.id, fields),
      onBookOrderChange: order => Promise.all(order.map(({ id, shelfOrder }) => library.patch(id, { shelfOrder })))
    })
  } else {
    shelf.update(books)
  }
}

async function openBookRecord(book, ctx) {
  const transition = {
    onReaderReady: async () => {
      await ctx.finish?.()
      els.readerToolbar.hidden = false
      els.readerToolbar.classList.add('is-rising')
      void els.readerToolbar.offsetWidth
      requestAnimationFrame(() => els.readerToolbar.classList.add('is-visible'))
      setTimeout(() => els.readerToolbar.classList.remove('is-rising', 'is-visible'), 500)
    },
    onReaderError: () => ctx.close({ instant: true })
  }
  const prepared = preparedBooks.get(book.id)
  if (prepared) {
    try {
      if (await prepared) {
        preparedBooks.delete(book.id)
        await revealPreparedReader()
        await transition.onReaderReady()
        const record = await library.get(book.id)
        if (record) extractCoverInBackground(record)
        return
      }
    } catch (err) {
      preparedBooks.delete(book.id)
      console.warn('La preparación anticipada falló; se abrirá el libro ahora:', err)
    }
  }
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
        await openFile(file, { existingRecord: book, forcedId: book.id, transition })
        return
      } catch (err) {
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
          if (file) {
            await openFile(file, { existingRecord: book, forcedId: book.id, transition })
            return
          }
        }
      } catch (err) {
        console.warn('No se pudo leer el libro de la carpeta guardada, se pedirá manualmente:', err)
      }
    }

    // Fallback: el File original no sobrevive entre sesiones (o no se pudo
    // leer de la carpeta) — hay que volver a pedirlo.
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
        if (pendingLocalReopenId === book.id) {
          pendingLocalReopenId = null
          pendingReaderTransition = null
          ctx.close({ instant: true })
        }
      }, 400)
    }, { once: true })
    return
  }
  if (book.sourceType === 'drive') {
    try {
      const file = await cloudSync.downloadForOffline(book)
      await openFile(file, { existingRecord: book, transition })
    } catch (err) {
      ctx.close({ instant: true })
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
    await openFile(file, { forcedId, transition })
    return
  }

  // Importación nueva: si el navegador soporta elegir una carpeta real
  // (Chrome/Edge de escritorio), guarda ahí una copia del libro — pidiendo
  // que se elija una carpeta la primera vez — para poder reabrirlo después
  // sin tener que volver a seleccionarlo a mano.
  let folderFileName
  if (isFolderApiSupported()) {
    try {
      const folderHandle = await getOrChooseFolder()
      folderFileName = await saveFileIntoFolder(folderHandle, file)
    } catch (err) {
      console.warn('No se pudo guardar el libro en la carpeta elegida; se abre igualmente para esta sesión.', err)
    }
  }
  await openFile(file, { folderFileName })
})

// ---- Apertura y lectura ----

async function openFile(file, { existingRecord, forcedId, folderFileName, transition, preparing = false } = {}) {
  readingExperience.reset()
  currentBookId = null
  els.readerToolbar.hidden = Boolean(transition) || preparing
  if (preparing) {
    els.readerScreen.hidden = false
    els.readerScreen.classList.add('is-preparing')
  } else showScreen('reader')
  els.readerViewport.innerHTML = ''

  let format
  try {
    format = await reader.open(els.readerViewport, file, {
      onRelocate: onReaderRelocate,
      onUserNavigation: () => readingExperience.voice.stop(),
      onFollowLink: href => readingExperience.jump(null, href),
      onToggleChrome: () => { els.readerToolbar.hidden = !els.readerToolbar.hidden }
    })
  } catch (err) {
    if (transition) await transition.onReaderError?.()
    if (preparing) {
      els.readerScreen.classList.remove('is-preparing')
      els.readerScreen.hidden = true
    } else showScreen('home')
    if (err instanceof UnsupportedFormatError) {
      alert(`"${file.name}" no es un formato soportado. Formatos válidos: PDF, EPUB, MOBI, AZW3, FB2, CBZ.`)
    } else {
      alert(`No se pudo abrir "${file.name}": ${err.message}`)
      console.error(err)
    }
    return false
  }

  els.readerFormatBadge.textContent = format.label ?? ''

  const meta = reader.metadata
  const sourceType = existingRecord?.sourceType ?? 'local'
  // Cachea una copia de Drive para que la próxima apertura funcione sin red.
  const shouldCacheContent = !existingRecord?.content
  const baseFields = {
    id: forcedId,
    sourceType,
    driveFileId: existingRecord?.driveFileId,
    cloudAccountId: existingRecord?.cloudAccountId,
    mimeType: existingRecord?.mimeType ?? file.type,
    name: file.name,
    size: file.size,
    // Para el grosor real del lomo en la estantería (bookshelf-layout.js):
    // pageCount cuando el formato lo tiene (PDF), si no sizeBytes como proxy.
    pageCount: reader.pageCount ?? existingRecord?.pageCount,
    sizeBytes: file.size,
    folderFileName: folderFileName ?? existingRecord?.folderFileName,
    title: normalizeBookTitle(meta.title || existingRecord?.title || file.name, file.name),
    author: normalizeBookAuthor(existingRecord?.author) || normalizeBookAuthor(meta.author ?? meta.creator),
    format: format.label
  }
  let record
  try {
    record = await library.addOrTouch({
      ...baseFields,
      content: shouldCacheContent ? new Blob([file], { type: file.type }) : existingRecord?.content
    })
  } catch (err) {
    // Un libro muy grande puede agotar la cuota de IndexedDB del dispositivo.
    // Que eso falle no puede tirar abajo la lectura (el lector ya tiene el
    // fichero en memoria y sigue funcionando): se reintenta sin `content`,
    // igual que antes de este cambio — como mucho, la próxima vez habrá que
    // volver a elegir el archivo.
    console.warn('No se pudo guardar la copia del libro (¿cuota de almacenamiento?); se seguirá pidiendo el archivo al reabrir:', err)
    record = await library.addOrTouch({ ...baseFields, content: existingRecord?.content })
  }
  currentBookId = record.id

  if (existingRecord?.locator || existingRecord?.progressFraction) {
    restoringProgress = true
    try { await reader.goToLocator(existingRecord.locator, existingRecord.progressFraction) }
    finally { restoringProgress = false }
  }
  await readingExperience.open(record)

  if (!preparing) refreshShelf()
  if (!preparing) extractCoverInBackground(record)
  if (!preparing) await transition?.onReaderReady?.()
  if (sourceType === 'local' && !record.driveFileId) {
    try {
      // En Android, añadir un libro significa guardarlo en la cuenta de Drive.
      // Si aún no hay sesión, se completa el acceso antes de empezar la subida.
      if (isAndroidShell() && !hasDriveSession()) await requestDriveAccess()
      if (hasDriveSession()) await uploadBookToDrive(record)
    } catch (error) {
      setDriveSyncStatus(`No se pudo sincronizar: ${error.message}`)
      console.warn('No se pudo sincronizar el libro con Drive:', error)
      await reportDriveConnectionError(error)
    }
  }
  return true
}

function prepareBookOpen(book) {
  if (preparedBooks.has(book.id)) return
  const fileTask = book.content && (book.sourceType === 'local' || book.sourceType === 'drive')
    ? Promise.resolve(new File([book.content], book.name || book.title || 'libro', {
      type: book.mimeType || book.content.type || ''
    }))
    : book.sourceType === 'drive' && hasDriveSession()
      ? cloudSync.downloadForOffline(book) : null
  if (!fileTask) return
  const progressTask = book.driveFileId && hasDriveSession()
    ? cloudSync.syncBookProgress(book.id).catch(error => console.warn('Progreso remoto no disponible:', error))
    : Promise.resolve()
  const task = Promise.all([fileTask, progressTask]).then(async ([file]) => {
    const updated = await library.get(book.id) || book
    const opened = await openFile(file, { existingRecord: updated, forcedId: book.id, preparing: true })
    if (opened) extractCoverInBackground(await library.get(book.id) || updated)
    return opened
  })
  preparedBooks.set(book.id, task)
}

async function revealPreparedReader() {
  showScreen('reader')
  els.readerScreen.classList.remove('is-preparing')
}

async function handleCoverAction(action, book, button) {
  button.disabled = true
  const label = button.querySelector('span') || button
  const original = label.textContent
  const setLabel = text => { label.textContent = text; button.setAttribute('aria-label', text) }
  let saved = false
  setLabel(action === 'offline' ? 'Descargando…' : 'Guardando…')
  button.setAttribute('aria-busy', 'true')
  try {
    if (action === 'offline') {
      if (book.content) {
        setLabel('Disponible offline')
        saved = true
        return
      }
      if (!hasDriveSession()) await requestDriveAccess()
      if (book.sourceType === 'drive') {
        await cloudSync.downloadForOffline(book)
      } else {
        await uploadBookToDrive(book)
      }
      setLabel('Disponible offline')
      saved = true
    } else if (action === 'drive') {
      if (!hasDriveSession()) await requestDriveAccess()
      await uploadBookToDrive(book)
      setLabel('En Drive')
      saved = true
    }
  } catch (error) {
    setLabel(original)
    await reportDriveConnectionError(error)
  } finally {
    button.disabled = saved
    button.removeAttribute('aria-busy')
  }
}

async function uploadBookToDrive(book) {
  driveUploadsInFlight += 1
  els.driveUploadBook.textContent = book.title || book.name || 'Libro'
  els.driveUploadScreen.hidden = false
  els.driveUploadScreen.setAttribute('aria-busy', 'true')
  try {
    const updated = await cloudSync.uploadBook(book)
    await cloudSync.flushProgress(updated.id)
    setDriveSyncStatus('Sincronizado con Google Drive')
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
    throw new Error('La sesión de Google ha caducado. Pulsa Conectar.')
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
  showAuthNotice('Completa el acceso en Google. Tu biblioteca aparecerá al volver.', { pending: true })
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
    showAuthNotice('Actualiza la app Android para conectar con Google Drive.', { retry: true })
    return
  }
  showAuthNotice(error.message === 'Conexión cancelada.' ? '' : `No se pudo conectar con Google Drive. ${error.message}`, { retry: true })
}
els.driveThemeToggle.addEventListener('change', () => {
  const theme = els.driveThemeToggle.checked ? 'dark' : 'light'
  document.documentElement.setAttribute('data-theme', theme)
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
  if (coverUpgrades.has(record.id)) return coverUpgrades.get(record.id)
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
  const task = coverNeedsUpgrade()
    .then(needsCover => needsCover ? reader.getCoverBlob() : null)
    .then(blob => { if (blob?.size > 0) return library.setCover(record.id, blob) })
    .then(updated => { if (updated) refreshShelf() })
    .catch(err => console.warn('No se pudo extraer la portada:', err))
    .finally(() => coverUpgrades.delete(record.id))
  coverUpgrades.set(record.id, task)
  return task
}

function onReaderRelocate({ fraction, cfi, index }) {
  els.readerProgressFill.style.width = `${Math.round((fraction ?? 0) * 100)}%`
  readingExperience.relocate()
  if (!currentBookId || restoringProgress) return
  const locator = cfi ? { kind: 'cfi', value: cfi }
    : Number.isInteger(index) && reader.format?.engine === 'pdf' ? { kind: 'pdf-page', value: index + 1 }
      : null
  const bookId = currentBookId
  const previous = progressWrites.get(bookId) || Promise.resolve()
  const write = previous.catch(() => {}).then(() => library.updateProgress(bookId, fraction ?? 0, locator))
    .then(() => { if (hasDriveSession()) cloudSync.scheduleProgress(bookId) })
  progressWrites.set(bookId, write)
  write.catch(error => console.warn('No se pudo guardar el progreso:', error))
    .finally(() => { if (progressWrites.get(bookId) === write) progressWrites.delete(bookId) })
}

els.readerBack.addEventListener('click', () => {
  readingExperience.reset()
  const bookId = currentBookId
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
  // Monta el primer fotograma del vuelo antes de que el navegador pinte el
  // home. La actualización de IndexedDB puede esperar y se aplica al acabar
  // la animación, sin mostrar el lomo original entre medias.
  const returnFlight = shelf?.returnToShelf(bookId)
  refreshShelf()
  returnFlight?.catch(error => console.warn('No se pudo devolver el libro a la estantería:', error))
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
    els.driveStatus.textContent = files.length ? '' : 'No se encontraron libros en tu Drive.'
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
              name: f.name, title: normalizeBookTitle(f.name), mimeType: f.mimeType, size: Number(f.size) || 0 })
          const file = await cloudSync.downloadForOffline(record)
          await openFile(file, { existingRecord: record, forcedId: record.id })
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
        ? 'La actualización de Android para Google Drive aún no está publicada. Usa la versión web por ahora.'
        : `No se pudo conectar con Drive: ${err.message}`
    }
  }
}

// ---- Arranque ----

initTheme()
els.driveThemeToggle.checked = document.documentElement.getAttribute('data-theme') === 'dark'
els.appVersion.textContent = 'Inhouse Read · v1.1.8'
els.addDriveBtn.disabled = !isDriveConfigured()
els.addDriveBtn.title = isDriveConfigured() ? '' : 'Google Drive no está disponible'
showScreen('home')
refreshShelf()
loadDriveAccountProfile().catch(error => console.warn('No se pudo restaurar la cuenta:', error))
initAndroidUpdateChecks()
initContentFreshnessChecks()
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
