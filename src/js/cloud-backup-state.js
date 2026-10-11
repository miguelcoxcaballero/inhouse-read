// Library-sized checkpoints belong in IndexedDB, not synchronous localStorage.
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
