import { getRustShelf, requireRustShelf } from './rust-shelf.js';
import { extractPDFText } from './readers/pdf-text.js';
import { textLengthHost } from './book-length.js';
export const pdfLengthHost = { ...textLengthHost, extractPDFText };
/** The PDF engine supplies page text; Rust owns bounded traversal and counting. */
export function measurePDFBookLength(pdf, options = {}) {
  const native = getRustShelf();
  return native ? native.length_measure_pdf(pdf, options, pdfLengthHost)
    : requireRustShelf().then(native => native.length_measure_pdf(pdf, options, pdfLengthHost));
}
