/** Consume the Android intent inbox without passing entire books as base64 strings. */
export function initAndroidFileImports({ onFile, onError, onActivity, canImport = () => true,
  bridge = globalThis.InhouseBookImports, pollMs = 1000 } = {}) {
  if (!bridge?.pending || !bridge?.readChunk || !bridge?.acknowledge) return () => {}
  let busy = false
  let stopped = false
  const storageFailures = new Set()
  async function consume() {
    if (stopped || busy || !canImport() || document.visibilityState === 'hidden') return
    busy = true
    let active = false
    try {
      const entries = JSON.parse(bridge.pending())
      if (entries.some(entry => !storageFailures.has(entry.id))) {
        active = true
        onActivity?.(true)
      }
      for (const entry of entries) {
        if (stopped || !canImport()) break
        if (storageFailures.has(entry.id)) continue
        try {
          if (entry.error) throw new Error(entry.error)
          if (!Number.isSafeInteger(entry.size) || entry.size <= 0) throw new Error('El archivo está vacío o no se pudo leer.')
          const chunks = []
          let offset = 0
          while (offset < entry.size) {
            if (stopped) return
            const encoded = bridge.readChunk(entry.id, offset)
            const bytes = Uint8Array.from(atob(encoded), char => char.charCodeAt(0))
            if (!bytes.length || offset + bytes.length > entry.size) throw new Error('No se pudo leer el archivo completo. Vuelve a abrirlo desde Archivos.')
            chunks.push(bytes)
            offset += bytes.length
            await new Promise(resolve => setTimeout(resolve, 0))
          }
          const file = new File(chunks, entry.name, { type:entry.mimeType || 'application/octet-stream' })
          await onFile(file)
          bridge.acknowledge(entry.id)
        } catch (error) {
          if (error?.code === 'LOCAL_BOOK_STORAGE_FAILED') storageFailures.add(entry.id)
          await onError?.(error)
          // Keep the native original when IndexedDB could not commit it. A
          // return to this app after freeing space retries the same inbox file.
          if (error?.code !== 'LOCAL_BOOK_STORAGE_FAILED') bridge.acknowledge(entry.id)
        }
      }
    } catch (error) { await onError?.(error) }
    finally { busy = false; if (active) onActivity?.(false) }
  }
  const timer = setInterval(consume, pollMs)
  const onVisibilityChange = () => {
    if (document.visibilityState !== 'hidden') storageFailures.clear()
    consume()
  }
  document.addEventListener('visibilitychange', onVisibilityChange)
  consume()
  return () => { stopped = true; clearInterval(timer); document.removeEventListener('visibilitychange', onVisibilityChange) }
}
