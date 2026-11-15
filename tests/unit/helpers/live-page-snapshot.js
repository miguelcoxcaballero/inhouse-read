// Test harness: the doorways to the page snapshot of rust-ui (page_snapshot.rs) as src/js/readers/page-snapshot.js
// exported them, word for word. The readers ask rust-ui itself now (reader_doors.rs), so no production module imports
// them; the tests and the frozen references still do.
import { readerUI } from '../../../src/js/readers/rust-ui-required.js'

/** Copies before returning: subsequent PDF renders cannot alter the preview. */
export function snapshotCanvas(source, { filter = 'none', displayBounds, paper = false, paperSource = source } = {}) {
  return readerUI().snapshot_canvas(source, filter, displayBounds, paper, paperSource)
}

export const settlePageLayout = (doc = document, options) => readerUI().snapshot_settle(doc, options)

export const renderedPageFilter = (element, { themeFilter } = {}) => readerUI().snapshot_filter(element, themeFilter)

/** Composite visible fixed-layout spread frames into the same reader viewport. */
export const compositePageSnapshots = (snapshots, options) => readerUI().snapshot_composite(snapshots, options)

/**
 * Snapshot DOM in its actual visible viewport, including iframe offset after
 * a Foliate column/CFI jump. No HTML serialization or remote image requests.
 * This is safe to use as a GPU canvas texture even with external ebook images.
 */
export const snapshotDOMPage = (root, options = {}) => readerUI().snapshot_dom_page(root, options)
export const plainBounds = rect => readerUI().snapshot_bounds(rect)
/** Rasterize existing inline SVG without requesting any network resources (the page snapshot does it inside rust-ui). */
export const rasterizeInlineSVG = (svg, options) => readerUI().snapshot_svg(svg, options)
/** Does a computed CSS colour (rgb()) equal a theme colour (#rrggbb)? */
export const sameColor = (a, b) => readerUI().snapshot_same_color(a, b)
