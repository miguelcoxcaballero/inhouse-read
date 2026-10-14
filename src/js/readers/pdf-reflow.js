import { pdfPlaceFigures } from './pdf-figures-wasm.js'
import { readerUI } from './rust-ui-required.js'
export { pdfFigureOffset } from './pdf-figures-wasm.js'
export { pdfImageRects } from './pdf-images-wasm.js'
// Render illustrations from PDF.js's original composite pixels: transforms,
// transparency, clipping and colour profiles remain the renderer's job.
// Text stays in its exact source-offset stream even when a picture splits it.
// Cutting the text at the pictures, cropping them in small tasks and committing
// the page only when everything is ready is Rust (reflow_* in rust-ui).
export const clearPDFReflow = root => readerUI().reflow_clear(root)
export const populatePDFReflow = (root, layout, source, rects = [], viewport) => readerUI().reflow_populate(root, layout, source, rects, viewport, pdfPlaceFigures)
export const preparePDFReflow = (root, layout, source, rects = [], viewport, isActive = () => true) => readerUI().reflow_prepare(root, layout, source, rects, viewport, isActive, pdfPlaceFigures)
