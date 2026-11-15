// A one-shot image of an already laid out reading page. Opening a book must
// use its restored page, not a fabricated block of text or the cover thumbnail.
// Text is painted at the browser's measured glyph positions, so pagination,
// headings, chosen fonts and images remain tied to the live reader.
// Every decision, every canvas call and every wait is Rust (page_snapshot and
// snapshot_promises in rust-ui); these are the names the readers import.
import { readerUI } from './rust-ui-required.js'

/** Copies before returning: subsequent PDF renders cannot alter the preview. */
export function snapshotCanvas(source, { filter = 'none', displayBounds, paper = false, paperSource = source } = {}) {
  return readerUI().snapshot_canvas(source, filter, displayBounds, paper, paperSource)
}

export const settlePageLayout = (doc = document, options) => readerUI().snapshot_settle(doc, options)

export const renderedPageFilter = (element, { themeFilter } = {}) => readerUI().snapshot_filter(element, themeFilter)

/** Rasterize existing inline SVG without requesting any network resources. */
export const rasterizeInlineSVG = (svg, options) => readerUI().snapshot_svg(svg, options)

/** Composite visible fixed-layout spread frames into the same reader viewport. */
export const compositePageSnapshots = (snapshots, options) => readerUI().snapshot_composite(snapshots, options)

/**
 * Snapshot DOM in its actual visible viewport, including iframe offset after
 * a Foliate column/CFI jump. No HTML serialization or remote image requests.
 * This is safe to use as a GPU canvas texture even with external ebook images.
 */
export const snapshotDOMPage = (root, options = {}) => readerUI().snapshot_dom_page(root, options)
