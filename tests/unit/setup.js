import 'fake-indexeddb/auto'

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
