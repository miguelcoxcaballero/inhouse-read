import 'fake-indexeddb/auto'
import { readFileSync } from 'node:fs'
import { beforeEach, vi } from 'vitest'
// The live shelf is built with the shelf module and the numeric core already in (its first render
// awaits both), so every test of the shelf starts from the same state.
import './helpers/rust-shelf-ready.js'
import './helpers/rust-core-ready.js'
import './helpers/rust-voice-ready.js'
import './helpers/rust-voice-ui-ready.js'

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

// The page compiles the Rust cores while the app's modules load (index.html)
// and the shelf's data modules wait for those same instances: the app core for
// the cabinets and the layout, the decor core for the plant, pot and lamp
// tables. Each test starts with the equivalent early instances on offer (a
// loader consumes its promise once, and tests reset modules to load a fresh
// copy of the app); every WebAssembly module is compiled once per worker
// process and an instance is only made when a loader actually awaits it.
if (typeof WebAssembly === 'object') {
  const compiled = (key, file) => (process[key] ??= new WebAssembly.Module(readFileSync(file)))
  const early = (key, file) => ({ then: (resolve, reject) => WebAssembly.instantiate(compiled(key, file)).then(resolve, reject) })
  const offer = () => {
    globalThis.__inhouseRustReady = early('__inhouseCoreModule', 'src/wasm/inhouse_read_core.wasm')
    globalThis.__inhouseDecorReady = early('__inhouseDecorModule', 'src/wasm/inhouse_read_decor.wasm')
    globalThis.__inhouseVoiceReady = early('__inhouseVoiceModule', 'src/wasm/inhouse_read_voice.wasm')
  }
  offer()
  beforeEach(offer)
  // A test that resets the module registry loads a fresh copy of the app, which
  // awaits its own early instances (as a new page load does).
  const resetModules = vi.resetModules.bind(vi)
  vi.resetModules = () => { const result = resetModules(); offer(); return result }
}
