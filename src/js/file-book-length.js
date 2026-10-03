import { detectFormat, ENGINE } from './format-detect.js';
import { measureBookLength } from './book-length.js';
import { measurePDFBookLength } from './pdf-book-length.js';

/** Detached parsing outlives reader navigation. Lazy imports mean a home with
 * fully counted books does not download a reading engine or parse any files. */
export async function measureFileBookLength(file, options = {}) {
  const isActive = options.isActive || (() => true);
  if (!file?.size || !isActive()) return null;
  const format = await detectFormat(file);
  if (!isActive()) return null;
  if (format.engine === ENGINE.PDF) {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const worker = await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url');
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
    if (!isActive()) return null;
    const data = new Uint8Array(await file.arrayBuffer());
    if (!isActive()) return null;
    const task = pdfjs.getDocument({ data });
    try { return await measurePDFBookLength(await task.promise, options); }
    finally { await task.destroy(); }
  }
  if (format.engine === ENGINE.FOLIATE) {
    const { makeBook } = await import('foliate-js/view.js');
    if (!isActive()) return null;
    const book = await makeBook(file);
    try { return await measureBookLength(book, options); }
    finally { book.destroy?.(); }
  }
  return null;
}
