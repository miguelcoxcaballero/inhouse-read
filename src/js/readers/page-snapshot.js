// A one-shot image of an already laid out reading page. Opening a book must
// use its restored page, not a fabricated block of text or the cover thumbnail.
// Text is painted at the browser's measured glyph positions, so pagination,
// headings, chosen fonts and images remain tied to the live reader.
// Every decision and every canvas call is Rust (page_snapshot in rust-ui); what
// stays here is the promise plumbing the browser asks for: a deadline, a Blob
// read and an image load.
import { readerUI } from './rust-ui-required.js'

function beforeDeadline(promise, deadline) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Reading image decode timed out')), Math.max(0, deadline - performance.now()))
    Promise.resolve(promise).then(value => { clearTimeout(timer); resolve(value) }, error => { clearTimeout(timer); reject(error) })
  })
}

function blobDataURL(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

const localBlob = href => fetch(href).then(response => response.blob())
const loadImage = (image, url) => new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; image.src = url })
const snapshotKit = () => [beforeDeadline, localBlob, blobDataURL, loadImage]

export const plainBounds = rect => readerUI().snapshot_bounds(rect)

/** Copies before returning: subsequent PDF renders cannot alter the preview. */
export function snapshotCanvas(source, { filter = 'none', displayBounds, paper = false, paperSource = source } = {}) {
  return readerUI().snapshot_canvas(source, filter, displayBounds, paper, paperSource)
}

export const settlePageLayout = (doc = document, options) => readerUI().snapshot_settle(doc, options)

export const renderedPageFilter = (element, { themeFilter } = {}) => readerUI().snapshot_filter(element, themeFilter)

/** Rasterize existing inline SVG without requesting any network resources. */
export const rasterizeInlineSVG = (svg, options) => readerUI().snapshot_svg(svg, options, ...snapshotKit())

/** Composite visible fixed-layout spread frames into the same reader viewport. */
export const compositePageSnapshots = (snapshots, options) => readerUI().snapshot_composite(snapshots, options)

/** Does a computed CSS colour (rgb()) equal a theme colour (#rrggbb)? */
export const sameColor = (a, b) => readerUI().snapshot_same_color(a, b)

/**
 * Snapshot DOM in its actual visible viewport, including iframe offset after
 * a Foliate column/CFI jump. No HTML serialization or remote image requests.
 * This is safe to use as a GPU canvas texture even with external ebook images.
 */
export const snapshotDOMPage = (root, options = {}) => readerUI().snapshot_dom_page(root, options, ...snapshotKit())
