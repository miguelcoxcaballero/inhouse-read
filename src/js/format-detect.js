// Detección de formato de libro por firma de bytes (magic numbers), con
// fallback a la extensión del nombre de archivo cuando la firma no basta
// (p.ej. un EPUB y un CBZ son ambos ZIP a nivel de bytes).
//
// El motor de lectura solo necesita distinguir dos rutas: 'pdf' (PDF.js) o
// 'foliate' (foliate-js, que ya hace su propia detección interna de
// epub/mobi/azw3/fb2/cbz). Exponemos además una `label` legible para la UI.

export const ENGINE = {
  PDF: 'pdf',
  FOLIATE: 'foliate',
  UNKNOWN: 'unknown'
}

const EXT_LABELS = {
  pdf: 'PDF',
  epub: 'EPUB',
  mobi: 'MOBI',
  azw: 'AZW',
  azw3: 'AZW3',
  kf8: 'AZW3',
  fb2: 'FB2',
  cbz: 'CBZ'
}

function getExtension(name = '') {
  const match = /\.([a-z0-9]+)$/i.exec(name.trim())
  return match ? match[1].toLowerCase() : ''
}

function bytesEqual(view, offset, expected) {
  for (let i = 0; i < expected.length; i++) {
    if (view[offset + i] !== expected.charCodeAt(i)) return false
  }
  return true
}

/**
 * Inspecciona los primeros bytes de un ArrayBuffer/Uint8Array y decide el
 * formato más probable. No requiere el archivo completo: con los primeros
 * ~200 bytes basta para PDF, ZIP (EPUB/CBZ) y PalmDOC/MOBI.
 */
export function sniffBytes(bytes) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)

  if (bytesEqual(view, 0, '%PDF-')) {
    return { engine: ENGINE.PDF, label: 'PDF', confidence: 'high' }
  }

  // ZIP local file header: PK\x03\x04 — EPUB, CBZ y FBZ son ZIP.
  if (view[0] === 0x50 && view[1] === 0x4b && view[2] === 0x03 && view[3] === 0x04) {
    return { engine: ENGINE.FOLIATE, label: 'EPUB', confidence: 'medium' }
  }

  // PalmDOC/MOBI: identificador de tipo en el offset 60 del header PDB.
  if (view.length >= 68) {
    const type = String.fromCharCode(...view.slice(60, 68))
    if (type === 'BOOKMOBI' || type === 'TEXtREAd') {
      return { engine: ENGINE.FOLIATE, label: 'MOBI', confidence: 'high' }
    }
  }

  // FB2 crudo: XML con <FictionBook.
  const head = String.fromCharCode(...view.slice(0, 200))
  if (/<\?xml/i.test(head) && /FictionBook/i.test(head)) {
    return { engine: ENGINE.FOLIATE, label: 'FB2', confidence: 'medium' }
  }

  return { engine: ENGINE.UNKNOWN, label: null, confidence: 'none' }
}

/**
 * Detecta el formato de un File/Blob leyendo solo su cabecera, y usa el
 * nombre de archivo como respaldo/afinado (p.ej. para distinguir EPUB de
 * CBZ, ambos ZIP, o cuando la firma de bytes no es concluyente).
 */
async function readHead(file, size = 200) {
  if (!file || typeof file.arrayBuffer !== 'function') return new Uint8Array(0)
  // En navegadores reales, file.slice().arrayBuffer() evita cargar el
  // archivo completo en memoria solo para leer la cabecera. jsdom (usado en
  // los tests unitarios) no implementa arrayBuffer() sobre el Blob que
  // devuelve slice(), así que ahí caemos a leer el archivo entero: los
  // fixtures de test son minúsculos, así que el coste es irrelevante.
  if (typeof file.slice === 'function') {
    try {
      const buf = await file.slice(0, size).arrayBuffer()
      return new Uint8Array(buf)
    } catch {
      // sigue al fallback de abajo
    }
  }
  const full = new Uint8Array(await file.arrayBuffer())
  return full.slice(0, size)
}

export async function detectFormat(file) {
  const name = file?.name || ''
  const ext = getExtension(name)
  const head = await readHead(file)

  const sniffed = sniffBytes(head)

  if (sniffed.engine === ENGINE.PDF) {
    return { engine: ENGINE.PDF, label: 'PDF', source: 'bytes' }
  }

  if (sniffed.engine === ENGINE.FOLIATE) {
    // Si la extensión conocida es más específica que "EPUB" (p.ej. cbz,
    // mobi, azw3, fb2), preferimos la extensión para la etiqueta visible;
    // el engine sigue siendo 'foliate' para todos estos casos.
    const label = EXT_LABELS[ext] ?? sniffed.label
    return { engine: ENGINE.FOLIATE, label, source: 'bytes+ext' }
  }

  // Sin firma reconocible (o buffer vacío en tests/entradas parciales):
  // caemos a la extensión.
  if (ext && EXT_LABELS[ext]) {
    const engine = ext === 'pdf' ? ENGINE.PDF : ENGINE.FOLIATE
    return { engine, label: EXT_LABELS[ext], source: 'ext' }
  }

  return { engine: ENGINE.UNKNOWN, label: null, source: 'none' }
}

export function isSupported(detection) {
  return detection?.engine === ENGINE.PDF || detection?.engine === ENGINE.FOLIATE
}
