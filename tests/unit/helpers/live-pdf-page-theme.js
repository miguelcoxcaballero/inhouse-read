// Test harness: the argument defaults the readers' callers used to get from src/js/readers. Production calls the Rust export directly.
import { pdfImagePaths } from '../../../src/js/readers/pdf-images-wasm.js'
import { readerUI } from '../../../src/js/readers/rust-ui-required.js'

// PDF.js reports image footprints in normalized page coordinates. Theme the
// printed paper/ink once, then copy the ORIGINAL pixels inside each footprint.
// No pixel readback or CPU loop is needed, including for monochrome photos.
// Painting is Rust (pdf_paint_theme in rust-ui); the clipping paths come from
// the numeric core.
export const paintPDFTheme = (source, target, filter, coordinates = []) => readerUI().pdf_paint_theme(source, target, filter, coordinates, pdfImagePaths)

// Stencil masks still bypass PDF.js's image-footprint tracker. Preserve their
// original printed page rather than guess bounds. The guarded Vite patch now
// records grouped/repeated ordinary images at every actual draw transform.
export const hasUntrackedPDFImages = (operatorList, ops) => readerUI().pdf_untracked_images(operatorList, ops)
