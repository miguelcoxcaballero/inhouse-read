import { detectFormat, ENGINE } from './format-detect.js';
import { getRustShelf, requireRustShelf } from './rust-shelf.js';
import { pdfLengthHost } from './pdf-book-length.js';
const env = { ...pdfLengthHost, detectFormat, ENGINE,
  loadPDF:() => import('pdfjs-dist/legacy/build/pdf.mjs'),
  loadWorker:() => import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'),
  loadFoliate:() => import('foliate-js/view.js') };
/** Rust owns detached parsing, cancellation and cleanup; imports remain lazy. */
export function measureFileBookLength(file, options = {}) {
  const native = getRustShelf();
  return native ? native.length_measure_file(file, options, env)
    : requireRustShelf().then(native => native.length_measure_file(file, options, env));
}
