// Which engine opens a book (PDF.js for 'pdf', foliate-js for EPUB/MOBI/AZW3/FB2/CBZ) is decided
// by its byte signature and, as a fallback, its extension: rust-ui format_detect.rs, with the
// numeric core's header scanner. Reading the head of a File stays here. The frozen original is
// tests/unit/helpers/reference-format-detect.js.
import { rustBookFormat } from './book-format-wasm.js'
import { getRustCore } from './rust-core.js'
import { coreBridge } from './readers/core-bridge.js'

export const ENGINE = {
  PDF: 'pdf',
  FOLIATE: 'foliate',
  UNKNOWN: 'unknown'
}

/** The most probable format of the first bytes of an ArrayBuffer/Uint8Array (~200 are enough). */
export const sniffBytes = bytes => coreBridge().format_sniff(bytes, rustBookFormat, getRustCore())

// Only the head is read; jsdom's Blob from slice() has no arrayBuffer(), so tests read the whole
// (tiny) fixture instead.
async function readHead(file, size = 200) {
  if (!file || typeof file.arrayBuffer !== 'function') return new Uint8Array(0)
  if (typeof file.slice === 'function') {
    try { return new Uint8Array(await file.slice(0, size).arrayBuffer()) } catch { /* whole file below */ }
  }
  return new Uint8Array(await file.arrayBuffer()).slice(0, size)
}

/** The format of a File/Blob from its head, refined by its name (EPUB and CBZ are both ZIP). */
export async function detectFormat(file) {
  return coreBridge().format_detect(file, await readHead(file), rustBookFormat, getRustCore())
}

export function isSupported(detection) {
  return detection?.engine === ENGINE.PDF || detection?.engine === ENGINE.FOLIATE
}
