// The JPEG of a PDF's cover, encoded by a worker where the page can hand it a bitmap and by the canvas elsewhere:
// rust-ui cover_encode.rs. The worker's URL is written here, where the bundler sees it.
import { readerUI } from './rust-ui-required.js'
const createWorker = () => new Worker(new URL('./cover-encode-worker.js', import.meta.url), { type:'module' })
/** The cover as a JPEG Blob at its original size, or null for an import that was given up (`signal`). */
export const encodePdfCover = (canvas, options) => readerUI().cover_encode_pdf(canvas, options, createWorker)
