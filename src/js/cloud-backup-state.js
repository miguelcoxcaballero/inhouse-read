// Library-sized checkpoints belong in IndexedDB, not synchronous localStorage.
import { loadedCloudModule } from './cloud-native.js'
let connection
function database() {
  return connection ||= new Promise((resolve, reject) => {
    const request = indexedDB.open('inhouse-read-cloud-state', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('checkpoints')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => { connection = null; reject(request.error) }
  })
}
export async function readBackupCheckpoint(key) {
  const db = await database()
  return new Promise((resolve, reject) => {
    const request = db.transaction('checkpoints').objectStore('checkpoints').get(key)
    request.onsuccess = () => resolve(request.result || { books:{}, settings:{} })
    request.onerror = () => reject(request.error)
  })
}
export async function saveBackupCheckpoint(key, value) {
  const db = await database()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('checkpoints', 'readwrite')
    transaction.objectStore('checkpoints').put(value, key)
    transaction.oncomplete = resolve
    transaction.onabort = () => reject(transaction.error || new Error('No se pudo guardar el estado de sincronización.'))
    transaction.onerror = () => reject(transaction.error)
  })
}

/** Merge field registers inside one transaction, so an older network write
 * cannot replace a newer local/direct checkpoint. The merge stays in Rust. */
export async function mergeBackupCheckpoint(key, value) {
  const db = await database(), ui = loadedCloudModule()
  if (!ui) throw new Error('El módulo de sincronización no está preparado.')
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('checkpoints', 'readwrite'), store = transaction.objectStore('checkpoints')
    let merged
    const request = store.get(key)
    request.onsuccess = () => {
      try { merged = ui.library_merge_checkpoint(request.result || { books:{}, settings:{} }, value); store.put(merged, key) }
      catch (error) { transaction.abort(); reject(error) }
    }
    transaction.oncomplete = () => resolve(merged)
    transaction.onabort = () => reject(transaction.error || new Error('No se pudo guardar el estado de sincronización.'))
    transaction.onerror = () => reject(transaction.error)
  })
}
