/** Consume the Android intent inbox without passing entire books as base64 strings. */
export function initAndroidFileImports({ onFile, onError, canImport = () => true,
  bridge = globalThis.InhouseBookImports, pollMs = 1000 } = {}) {
  if (!bridge?.pending || !bridge?.readChunk || !bridge?.acknowledge) return () => {}
  let busy = false
  let stopped = false
  async function consume() {
    if (stopped || busy || !canImport() || document.visibilityState === 'hidden') return
    busy = true
    try {
      const entries = JSON.parse(bridge.pending())
      for (const entry of entries) {
        if (stopped || !canImport()) break
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
          await onError?.(error)
          bridge.acknowledge(entry.id)
        }
      }
    } catch (error) { await onError?.(error) }
    finally { busy = false }
  }
  const timer = setInterval(consume, pollMs)
  document.addEventListener('visibilitychange', consume)
  consume()
  return () => { stopped = true; clearInterval(timer); document.removeEventListener('visibilitychange', consume) }
}
