// Guarda los libros importados dentro de una carpeta real del dispositivo,
// elegida una vez por el usuario, usando la File System Access API
// (`showDirectoryPicker`).
//
// LIMITACIÓN REAL — léase antes de asumir que esto funciona en todas partes:
// `showDirectoryPicker` solo existe en navegadores Chromium de escritorio
// (Chrome/Edge en Windows/Mac/Linux). NO está disponible en:
//   - Chrome para Android (ni ningún navegador móvil, de hecho)
//   - Ningún WebView embebido, incluido el de la app Android empaquetada
//     con Capacitor (android/html_to_apk_builder.py)
//   - Safari (de escritorio o iOS)
// `isFolderApiSupported()` detecta esto y el resto de la app debe comportarse
// como hasta ahora (biblioteca solo en IndexedDB, hay que volver a
// seleccionar el archivo al reabrir) cuando devuelve false. No hay ningún
// polyfill razonable: la alternativa nativa real para la app Android sería
// un plugin de Capacitor a medida invocando Storage Access Framework, que no
// está implementado (ver android/README.md).

import { getRustCore, loadRustCore } from './rust-core.js'
import { requireCore } from './core-tables.js'
import { withCloudModule } from './cloud-native.js'

// The names, the copy, the read-back and the permission are rust-ui/src/folder_store.rs and
// rust-core/src/file_name.rs; the directory handle is stored here, in IndexedDB, and the picker is the browser's.
const core = await requireCore(getRustCore, loadRustCore, 'sanitize_file_name')

const DB_NAME = 'inhouse-read-folder'
const DB_VERSION = 1
const STORE = 'handles'
const HANDLE_KEY = 'library-folder'

export function isFolderApiSupported() {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function'
}

function openHandleDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function wrap(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

/** Handle guardado de una sesión anterior, o null si nunca se eligió carpeta. */
export async function getSavedFolderHandle() {
  if (!isFolderApiSupported()) return null
  const db = await openHandleDB()
  const handle = await wrap(db.transaction(STORE, 'readonly').objectStore(STORE).get(HANDLE_KEY))
  return handle ?? null
}

async function persistFolderHandle(handle) {
  const db = await openHandleDB()
  await wrap(db.transaction(STORE, 'readwrite').objectStore(STORE).put(handle, HANDLE_KEY))
}

/** Pide al usuario que elija una carpeta y la recuerda para la próxima vez. */
export async function chooseFolder() {
  const handle = await window.showDirectoryPicker({ id: 'inhouse-read-library', mode: 'readwrite' })
  await persistFolderHandle(handle)
  return handle
}

/** The permission of a stored directory may have lapsed: it is asked for again before reading or writing. */
export const ensureFolderPermission = handle => withCloudModule(ui => ui.ensureFolderPermission(handle))

/** Handle ya guardado y con permiso vigente, o pide elegir uno nuevo si hace falta. */
export const getOrChooseFolder = () => withCloudModule(ui => ui.getOrChooseFolder(getSavedFolderHandle, chooseFolder))

/** `String(name)` with every run of reserved characters replaced by one underscore, trimmed; "libro" when nothing is left. */
export function sanitizeFileName(name) {
  const text = String(name)
  const words = Math.ceil(Math.max(text.length, 5) / 4)
  const input = core.alloc_f64(words)
  const output = core.alloc_f64(words)
  try {
    if (!input || !output) throw new RangeError('The file name is too long')
    const units = new Uint16Array(core.memory.buffer, input, text.length)
    for (let index = 0; index < text.length; index++) units[index] = text.charCodeAt(index)
    const length = core.sanitize_file_name(input, text.length, output, words * 4)
    const clean = new Uint16Array(core.memory.buffer, output, length)
    let result = ''
    for (let index = 0; index < length; index += 8192) result += String.fromCharCode(...clean.subarray(index, index + 8192))
    return result
  } finally {
    if (input) core.free_f64(input, words)
    if (output) core.free_f64(output, words)
  }
}

/** Evita pisar un archivo distinto con el mismo nombre; el mismo tamaño se toma por el mismo libro. */
export const resolveNonCollidingName = (handle, name, size) => withCloudModule(ui => ui.resolveNonCollidingName(handle, name, size))

/** Copia el archivo dentro de la carpeta elegida. Devuelve el nombre final usado. */
export const saveFileIntoFolder = (handle, file) => withCloudModule(ui => ui.saveFileIntoFolder(handle, file, sanitizeFileName))

/** Lee de vuelta un libro ya guardado, o null si ya no está (borrado, etc.). */
export const readFileFromFolder = (handle, name) => withCloudModule(ui => ui.readFileFromFolder(handle, name))
