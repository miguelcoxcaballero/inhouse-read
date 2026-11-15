// Test harness: the argument defaults src/js/readers used to hold for the reflow. The reader calls reflow_* and the
// pictures' kernels (pdf_image_rects, pdf_place_figures: rust-ui pdf_pictures.rs) in rust-ui directly.
import { readerUI } from '../../../src/js/readers/rust-ui-required.js'
/** Composite illustration bounds of a page. An unusable page size has no visible regions. */
export const pdfImageRects = (coordinates, width, height) => readerUI().pdf_image_rects(coordinates, width, height)
/** Illustrations with the UTF-16 offset of the text they precede, in reading order. */
export const pdfPlaceFigures = (rects, layout, source, viewport) => readerUI().pdf_place_figures(rects, layout, source, viewport)
export const pdfFigureOffset = (rect, layout, source, viewport) => pdfPlaceFigures([rect], layout, source, viewport)[0].offset
// Render illustrations from PDF.js's original composite pixels: transforms,
// transparency, clipping and colour profiles remain the renderer's job.
// Text stays in its exact source-offset stream even when a picture splits it.
// Cutting the text at the pictures, cropping them in small tasks and committing
// the page only when everything is ready is Rust (reflow_* in rust-ui).
export const clearPDFReflow = root => readerUI().reflow_clear(root)
export const populatePDFReflow = (root, layout, source, rects = [], viewport) => readerUI().reflow_populate(root, layout, source, rects, viewport)
export const preparePDFReflow = (root, layout, source, rects = [], viewport, isActive = () => true) => readerUI().reflow_prepare(root, layout, source, rects, viewport, isActive)
