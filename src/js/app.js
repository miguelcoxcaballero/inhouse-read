import { LibraryStore } from './library-store.js'
import { renderBookshelf } from './bookshelf.js'
import { ReaderController, UnsupportedFormatError } from './readers/reader-controller.js'
import {
  isDriveConfigured, requestDriveAccess, listDriveBooks, downloadDriveFile, hasDriveSession,
  uploadDriveFile, getDriveProfile, signOutDrive
} from './drive-client.js'
import {
  isFolderApiSupported, getSavedFolderHandle, getOrChooseFolder, ensureFolderPermission,
  saveFileIntoFolder, readFileFromFolder
} from './local-folder-store.js'
import { initAndroidUpdateChecks } from './android-update.js'
import { initContentFreshnessChecks } from './content-freshness.js'

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
  driveSyncBtn: document.getElementById('drive-sync-btn'),
  driveSignOutBtn: document.getElementById('drive-signout-btn')
}

let shelf = null
let currentBookId = null
let pendingLocalReopenId = null
let pendingReaderTransition = null
const preparedBooks = new Map()
const uploadingBooks = new Map()
let driveProfile = null

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
})

// ---- Navegación entre pantallas ----

function showScreen(name) {
  els.homeScreen.hidden = name !== 'home'
  els.readerScreen.hidden = name !== 'reader'
}

// ---- Home / estantería ----
// Contrato de renderBookshelf(container, books, options) documentado en el
// propio src/js/bookshelf.js (cabecera del archivo).

async function refreshShelf() {
  const books = await library.listRecents()
  if (!shelf) {
    shelf = renderBookshelf(els.bookshelfRoot, books, {
      onBookOpen: openBookRecord,
      onPrepareBook: prepareBookOpen,
      getBookPreparation: book => preparedBooks.get(book.id),
      onBookAction: handleCoverAction,
      onAddBooks: pickLocalFile,
      coverSrcFor: book => book.cover ?? null
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
        await transition.onReaderReady()
        revealPreparedReader()
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
      const file = await downloadDriveFile(book.driveFileId, { name: book.title, mimeType: book.mimeType })
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
  els.readerToolbar.hidden = Boolean(transition)
  if (preparing) {
    els.readerScreen.hidden = false
    els.readerScreen.classList.add('is-preparing')
  } else showScreen('reader')
  els.readerViewport.innerHTML = ''

  let format
  try {
    format = await reader.open(els.readerViewport, file, {
      onRelocate: onReaderRelocate,
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
    mimeType: existingRecord?.mimeType ?? file.type,
    name: file.name,
    size: file.size,
    // Para el grosor real del lomo en la estantería (bookshelf-layout.js):
    // pageCount cuando el formato lo tiene (PDF), si no sizeBytes como proxy.
    pageCount: reader.pageCount ?? existingRecord?.pageCount,
    sizeBytes: file.size,
    folderFileName: folderFileName ?? existingRecord?.folderFileName,
    title: existingRecord?.title ?? meta.title ?? stripExtension(file.name),
    author: existingRecord?.author ?? meta.author,
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

  if (existingRecord?.progressFraction) {
    await reader.goToFraction(existingRecord.progressFraction)
  }

  if (!preparing) refreshShelf()
  if (!preparing) extractCoverInBackground(record)
  if (!preparing) await transition?.onReaderReady?.()
  if (sourceType === 'local' && hasDriveSession() && !record.driveFileId) {
    uploadBookToDrive(record).catch(error => {
      setDriveSyncStatus(`No se pudo sincronizar: ${error.message}`)
      console.warn('No se pudo sincronizar el libro con Drive:', error)
    })
  }
  return true
}

function prepareBookOpen(book) {
  if (preparedBooks.has(book.id)) return
  let task
  if (book.content && (book.sourceType === 'local' || book.sourceType === 'drive')) {
    const file = new File([book.content], book.name || book.title || 'libro', { type: book.mimeType || book.content.type || '' })
    task = openFile(file, { existingRecord: book, forcedId: book.id, preparing: true })
  } else if (book.sourceType === 'drive' && hasDriveSession()) {
    task = downloadDriveFile(book.driveFileId, { name: book.name || book.title, mimeType: book.mimeType })
      .then(file => openFile(file, { existingRecord: book, forcedId: book.id, preparing: true }))
  }
  if (task) preparedBooks.set(book.id, Promise.resolve(task))
}

async function revealPreparedReader() {
  showScreen('reader')
  els.readerScreen.classList.remove('is-preparing')
}

async function handleCoverAction(action, book, button) {
  button.disabled = true
  const original = button.textContent
  button.textContent = action === 'offline' ? 'Descargando…' : 'Guardando…'
  try {
    if (action === 'offline') {
      if (book.content) {
        button.textContent = 'Disponible sin conexión'
        return
      }
      if (!hasDriveSession()) await requestDriveAccess()
      if (book.sourceType === 'drive') {
        const file = await downloadDriveFile(book.driveFileId, { name: book.name || book.title, mimeType: book.mimeType })
        await library.addOrTouch({ ...book, content: new Blob([file], { type: file.type }) })
      } else {
        await uploadBookToDrive(book)
      }
      button.textContent = 'Disponible sin conexión'
    } else if (action === 'drive') {
      if (!hasDriveSession()) await requestDriveAccess()
      await uploadBookToDrive(book)
      button.textContent = 'Guardado en Drive'
    }
  } catch (error) {
    button.textContent = original
    alert(`No se pudo completar la acción: ${error.message}`)
  } finally {
    button.disabled = false
  }
}

async function uploadBookToDrive(book) {
  if (uploadingBooks.has(book.id)) return uploadingBooks.get(book.id)
  const task = (async () => {
  const record = await library.get(book.id) || book
  if (record.driveFileId) return record
  if (!record.content) throw new Error('No se encontró una copia local del libro para subir.')
  const file = new File([record.content], record.name || record.title || 'libro', { type: record.mimeType || record.content.type || 'application/octet-stream' })
  const uploaded = await uploadDriveFile(file, { driveFileId: record.driveFileId, name: file.name })
  const updated = await library.addOrTouch({ ...record, sourceType: 'local', driveFileId: uploaded.id, driveFileName: uploaded.name })
  refreshShelf()
  setDriveSyncStatus('Sincronizado con Google Drive')
  return updated
  })()
  uploadingBooks.set(book.id, task)
  try { return await task } finally { uploadingBooks.delete(book.id) }
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
    els.driveProfile.hidden = true
    els.driveProfileMenu.hidden = true
    els.driveProfileBtn.setAttribute('aria-expanded', 'false')
    return null
  }
  els.driveProfile.hidden = false
  try {
    driveProfile = await getDriveProfile()
  } catch (error) {
    console.warn('No se pudo cargar el perfil de Google:', error)
    driveProfile = { name: 'Cuenta de Google', email: '', photo: '' }
  }
  els.driveProfileName.textContent = driveProfile.name
  els.driveProfileEmail.textContent = driveProfile.email
  els.driveProfileBtn.setAttribute('aria-label', driveProfile.email ? `Cuenta de Google: ${driveProfile.email}` : 'Cuenta de Google')
  els.driveProfileBtn.title = driveProfile.name
  setProfileAvatar(driveProfile)
  return driveProfile
}

async function syncLibraryToDrive({ silent = false } = {}) {
  if (!hasDriveSession()) {
    if (silent) return
    await requestDriveAccess()
  }
  await loadDriveAccountProfile()
  const books = await library.listRecents(500)
  const pending = books.filter(book => book.sourceType !== 'drive' && !book.driveFileId && book.content)
  if (!pending.length) {
    setDriveSyncStatus('Todo está sincronizado con Google Drive')
    return
  }
  let completed = 0
  setDriveSyncStatus(`Sincronizando 0 de ${pending.length} libros…`, true)
  for (const book of pending) {
    try {
      await uploadBookToDrive(book)
      completed += 1
      setDriveSyncStatus(`Sincronizando ${completed} de ${pending.length} libros…`, true)
    } catch (error) {
      setDriveSyncStatus(`Error al sincronizar ${book.title || book.name}: ${error.message}`)
      throw error
    }
  }
  setDriveSyncStatus(`Sincronización completa · ${completed} ${completed === 1 ? 'libro' : 'libros'}`)
}

els.driveProfileBtn.addEventListener('click', () => {
  const open = els.driveProfileMenu.hidden
  els.driveProfileMenu.hidden = !open
  els.driveProfileBtn.setAttribute('aria-expanded', String(open))
})
document.addEventListener('click', event => {
  if (!els.driveProfile.contains(event.target)) {
    els.driveProfileMenu.hidden = true
    els.driveProfileBtn.setAttribute('aria-expanded', 'false')
  }
})
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    els.driveProfileMenu.hidden = true
    els.driveProfileBtn.setAttribute('aria-expanded', 'false')
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
  driveProfile = null
  els.driveProfileMenu.hidden = true
  els.driveProfile.hidden = true
  els.driveProfileBtn.setAttribute('aria-expanded', 'false')
})
for (const image of [els.driveProfileAvatar, els.driveProfileAvatarMenu]) {
  image.addEventListener('error', () => {
    image.hidden = true
    image.previousElementSibling.hidden = false
  })
}

/** No bloquea la apertura del libro: la portada se guarda para la próxima visita a la estantería. */
function extractCoverInBackground(record) {
  if (record.cover) return
  reader.getCoverBlob()
    .then(blob => { if (blob) return library.setCover(record.id, blob) })
    .then(updated => { if (updated) refreshShelf() })
    .catch(err => console.warn('No se pudo extraer la portada:', err))
}

function stripExtension(name) {
  return name.replace(/\.[a-z0-9]+$/i, '')
}

function onReaderRelocate({ fraction }) {
  els.readerProgressFill.style.width = `${Math.round((fraction ?? 0) * 100)}%`
  if (currentBookId) library.updateProgress(currentBookId, fraction ?? 0)
}

els.readerBack.addEventListener('click', () => {
  reader.close()
  currentBookId = null
  showScreen('home')
  refreshShelf()
})
els.readerPrev.addEventListener('click', () => reader.prev())
els.readerNext.addEventListener('click', () => reader.next())

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
    const { files } = await listDriveBooks()
    els.driveStatus.textContent = files.length ? '' : 'No se encontraron libros en tu Drive.'
    for (const f of files) {
      const item = document.createElement('button')
      item.type = 'button'
      item.className = 'drive-item'
      item.textContent = f.name
      item.addEventListener('click', async () => {
        els.driveModal.hidden = true
        const file = await downloadDriveFile(f.id, { name: f.name, mimeType: f.mimeType })
        await openFile(file, { existingRecord: { sourceType: 'drive', driveFileId: f.id, mimeType: f.mimeType, title: f.name } })
      })
      els.driveList.append(item)
    }
    syncLibraryToDrive({ silent: true }).catch(error => {
      setDriveSyncStatus(`No se pudo sincronizar: ${error.message}`)
      console.warn('No se pudieron sincronizar los libros pendientes:', error)
    })
  } catch (err) {
    els.driveStatus.textContent = `No se pudo conectar con Drive: ${err.message}`
  }
}

// ---- Arranque ----

initTheme()
els.addDriveBtn.disabled = !isDriveConfigured()
els.addDriveBtn.title = isDriveConfigured() ? '' : 'Google Drive no está disponible'
showScreen('home')
refreshShelf()
initAndroidUpdateChecks()
initContentFreshnessChecks()
if (hasDriveSession()) {
  loadDriveAccountProfile()
    .then(() => syncLibraryToDrive({ silent: true }))
    .catch(error => console.warn('No se pudo restaurar la sincronización de Drive:', error))
}
