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

/**
 * El permiso sobre un directorio persistido puede haber caducado (el
 * navegador lo revoca si no se usa en un tiempo, o el usuario lo revocó a
 * mano). Hay que volver a pedirlo explícitamente antes de leer/escribir.
 */
export async function ensureFolderPermission(handle) {
  if (!handle) return false
  const opts = { mode: 'readwrite' }
  if ((await handle.queryPermission(opts)) === 'granted') return true
  try {
    return (await handle.requestPermission(opts)) === 'granted'
  } catch {
    // requestPermission() exige un gesto de usuario reciente; si no lo hay
    // (p.ej. se llama desde un evento no confiable) lanza en vez de negar.
    return false
  }
}

/** Handle ya guardado y con permiso vigente, o pide elegir uno nuevo si hace falta. */
export async function getOrChooseFolder() {
  const saved = await getSavedFolderHandle()
  if (saved && (await ensureFolderPermission(saved))) return saved
  return chooseFolder()
}

export function sanitizeFileName(name) {
  return String(name).replace(/[\\/:*?"<>|]+/g, '_').trim() || 'libro'
}

/**
 * Evita pisar un archivo distinto que ya exista con el mismo nombre en la
 * carpeta (dos libros distintos que se llamen igual). Si ya existe un
 * archivo con exactamente el mismo tamaño, se asume que es el mismo libro
 * y se reutiliza el nombre en vez de duplicarlo.
 */
export async function resolveNonCollidingName(handle, name, size) {
  let candidate = name
  let attempt = 1
  const dotIndex = name.lastIndexOf('.')
  const base = dotIndex === -1 ? name : name.slice(0, dotIndex)
  const ext = dotIndex === -1 ? '' : name.slice(dotIndex)

  while (true) {
    const existing = await handle.getFileHandle(candidate).catch(() => null)
    if (!existing) return candidate
    const existingFile = await existing.getFile()
    if (existingFile.size === size) return candidate
    attempt += 1
    candidate = `${base}-${attempt}${ext}`
  }
}

/** Copia el archivo dentro de la carpeta elegida. Devuelve el nombre final usado. */
export async function saveFileIntoFolder(handle, file) {
  const safeName = sanitizeFileName(file.name)
  const finalName = await resolveNonCollidingName(handle, safeName, file.size)
  const fileHandle = await handle.getFileHandle(finalName, { create: true })
  const writable = await fileHandle.createWritable()
  await writable.write(file)
  await writable.close()
  return finalName
}

/** Lee de vuelta un libro ya guardado, o null si ya no está (borrado, etc.). */
export async function readFileFromFolder(handle, name) {
  try {
    const fileHandle = await handle.getFileHandle(name)
    return await fileHandle.getFile()
  } catch {
    return null
  }
}
