import 'fake-indexeddb/auto'
import { readFileSync } from 'node:fs'

// La versión de jsdom usada por este entorno de test no implementa
// Blob/File.prototype.arrayBuffer() (sí existe en todos los navegadores
// reales). Sin este polyfill, format-detect.js caería siempre a su
// fallback por extensión y nunca ejercitaríamos de verdad la detección por
// firma de bytes en los tests.
if (typeof Blob !== 'undefined' && typeof Blob.prototype.arrayBuffer !== 'function') {
  Blob.prototype.arrayBuffer = function arrayBuffer() {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result)
      reader.onerror = () => reject(reader.error)
      reader.readAsArrayBuffer(this)
    })
  }
}

// The page compiles the Rust core while the app's modules load (index.html)
// and the shelf's data modules wait for that same instance. Every test file
// gets the equivalent early instance; the module is compiled once per worker.
if (typeof WebAssembly === 'object') {
  const compiled = (process.__inhouseCoreModule ??= new WebAssembly.Module(
    readFileSync('src/wasm/inhouse_read_core.wasm')))
  globalThis.__inhouseRustReady = WebAssembly.instantiate(compiled)
}
