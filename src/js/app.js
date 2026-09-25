import { LibraryStore } from './library-store.js'
import { renderBookshelf } from './bookshelf.js'
import { ReaderController, UnsupportedFormatError } from './readers/reader-controller.js'
import {
  isDriveConfigured, requestDriveAccess, listDriveBooks, downloadDriveFile, hasDriveSession
} from './drive-client.js'

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
  driveStatus: document.getElementById('drive-status')
}

let shelf = null
let currentBookId = null
let pendingLocalReopenId = null

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
      onAddBooks: pickLocalFile,
      coverSrcFor: book => book.cover ?? null
    })
  } else {
    shelf.update(books)
  }
}

async function openBookRecord(book, ctx) {
  if (book.sourceType === 'local') {
    // El File original no sobrevive entre sesiones: hay que volver a pedirlo.
    pendingLocalReopenId = book.id
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
          ctx.close()
        }
      }, 400)
    }, { once: true })
    return
  }
  if (book.sourceType === 'drive') {
    try {
      const file = await downloadDriveFile(book.driveFileId, { name: book.title, mimeType: book.mimeType })
      await openFile(file, { existingRecord: book })
    } catch (err) {
      ctx.close()
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
  await openFile(file, pendingLocalReopenId ? { forcedId: pendingLocalReopenId } : {})
  pendingLocalReopenId = null
})

// ---- Apertura y lectura ----

async function openFile(file, { existingRecord, forcedId } = {}) {
  showScreen('reader')
  els.readerViewport.innerHTML = ''

  let format
  try {
    format = await reader.open(els.readerViewport, file, {
      onRelocate: onReaderRelocate,
      onToggleChrome: () => { els.readerToolbar.hidden = !els.readerToolbar.hidden }
    })
  } catch (err) {
    showScreen('home')
    if (err instanceof UnsupportedFormatError) {
      alert(`"${file.name}" no es un formato soportado. Formatos válidos: PDF, EPUB, MOBI, AZW3, FB2, CBZ.`)
    } else {
      alert(`No se pudo abrir "${file.name}": ${err.message}`)
      console.error(err)
    }
    return
  }

  els.readerFormatBadge.textContent = format.label ?? ''

  const meta = reader.metadata
  const record = await library.addOrTouch({
    id: forcedId,
    sourceType: existingRecord?.sourceType ?? 'local',
    driveFileId: existingRecord?.driveFileId,
    mimeType: existingRecord?.mimeType ?? file.type,
    name: file.name,
    size: file.size,
    title: existingRecord?.title ?? meta.title ?? stripExtension(file.name),
    author: existingRecord?.author ?? meta.author,
    format: format.label
  })
  currentBookId = record.id

  if (existingRecord?.progressFraction) {
    await reader.goToFraction(existingRecord.progressFraction)
  }

  refreshShelf()
  extractCoverInBackground(record)
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
  } catch (err) {
    els.driveStatus.textContent = `No se pudo conectar con Drive: ${err.message}`
  }
}

// ---- Arranque ----

initTheme()
els.addDriveBtn.disabled = !isDriveConfigured()
els.addDriveBtn.title = isDriveConfigured() ? '' : 'Configura googleClientId en config.js para activar Drive'
showScreen('home')
refreshShelf()
