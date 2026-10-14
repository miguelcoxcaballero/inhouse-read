import { cloudModule, loadedCloudModule } from './cloud-native.js'

/** Consume the Android intent inbox without passing entire books as base64 strings
 * (rust-ui/src/android_import.rs). The bridge, the timers and the page visibility are
 * handed to the Rust importer as callbacks; where the module is not in memory yet, it
 * starts once the first shelf frame has drawn. */
export function initAndroidFileImports({ onFile, onError, onActivity, canImport = () => true,
  bridge = globalThis.InhouseBookImports, pollMs = 1000 } = {}) {
  if (!bridge?.pending || !bridge?.readChunk || !bridge?.acknowledge) return () => {}
  const host = {
    bridge, onFile, onError, onActivity, canImport, pollMs,
    hidden: () => document.visibilityState === 'hidden',
    yieldTask: () => new Promise(resolve => setTimeout(resolve, 0)),
    interval: (callback, delay) => setInterval(callback, delay),
    clearInterval: timer => clearInterval(timer),
    listen(callback) {
      document.addEventListener('visibilitychange', callback)
      return () => document.removeEventListener('visibilitychange', callback)
    }
  }
  let importer = null
  let stopped = false
  const begin = ui => { if (!stopped) importer = new ui.RustAndroidImports(host) }
  const ready = loadedCloudModule()
  if (ready) begin(ready)
  else cloudModule().then(begin, error => onError?.(error))
  return () => { stopped = true; importer?.stop(); importer?.free(); importer = null }
}
