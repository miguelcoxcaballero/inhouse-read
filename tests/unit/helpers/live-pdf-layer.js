// The map of a PDF.js text layer onto the joined text that reflow speaks, as the PDF reader asks rust-ui for it
// (reader_doors.rs `pdf_layer_mapped`): `{text, spans, rangeFor, offsetOf}`, or null when the layer is not the layout's.
import { readerUI } from '../../../src/js/readers/rust-ui-required.js'
export const mapPDFTextLayer = (layer, layout) => { const ui = readerUI(); return ui.pdf_layer_mapped(ui, layer, layout) }
