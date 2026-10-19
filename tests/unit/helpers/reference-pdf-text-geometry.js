// Frozen from 0a4d84ea (1.7.309): extractPDFText with its item geometry still in JavaScript; the
// row, order and stream kernels are the production Rust ones, so a difference is the geometry's.
// PDF text items follow the order in which the file paints glyphs, which need
// not be its reading order. This page-local layout keeps every text item and
// its source offsets: the same result feeds reflow, speech and the text layer.
// No OCR, language model, repeated-line removal or guessed missing text.
import { assemblePDFLines } from '../../../src/js/readers/pdf-stream-wasm.js'
import { pdfOrderLines as orderLines } from '../../../src/js/readers/pdf-order-wasm.js'
import { PDF_TEXT_ITEM_LIMIT, pdfRowLines } from '../../../src/js/readers/pdf-row-layout-wasm.js'

const DEFAULT_VIEW = [1, 0, 0, -1, 0, 0]
const finite = value => Number.isFinite(Number(value))
const multiply = (a, b) => [
  a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
  a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
  a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]
]

function fallback(content) {
  return { geometric:false, items:content.items || [], lines:[], paragraphs:[], spans:[],
    text:(content.items || []).filter(item => typeof item.str === 'string')
      .map(item => item.str + (item.hasEOL ? '\n' : ' ')).join('') }
}


/** Page-local reading layout. Text without usable geometry keeps the legacy stream order verbatim. */
export function extractPDFText(content, viewport) {
  const raw = (content?.items || []).map((item, rawIndex) => ({ item, rawIndex }))
    .filter(({ item }) => typeof item.str === 'string' && item.str)
  if (!raw.length) return fallback(content || {})
  // The kernels order up to this many text items; a page with more keeps the
  // complete stream in the order the file paints it.
  if (raw.length > PDF_TEXT_ITEM_LIMIT) return fallback(content)
  const view = Array.isArray(viewport?.transform) && viewport.transform.length === 6 && viewport.transform.every(finite)
    ? viewport.transform : DEFAULT_VIEW
  const positioned = raw.filter(({ item }) => item.transform?.length === 6 && [...item.transform].every(finite)
    && Math.hypot(item.transform[0], item.transform[1]) > 0)
  // Partial/corrupt geometry is not grounds to drop text or append it in a
  // guessed place. Keep its original order until the PDF supplies all boxes.
  if (positioned.length !== raw.length) return fallback(content)
  const transforms = positioned.map(entry => ({ ...entry, transformed:multiply(view, entry.item.transform) }))
  const dominant = [...transforms].sort((a, b) => b.item.str.trim().length - a.item.str.trim().length)[0]
  const angle = Math.atan2(dominant.transformed[1], dominant.transformed[0])
  const cos = Math.cos(angle), sin = Math.sin(angle), scale = Math.hypot(view[0], view[1]) || 1
  // Mixed vertical/rotated writing requires a structural reading order that
  // these horizontal boxes cannot safely infer. Preserve all original items.
  if (transforms.some(({ transformed, item }) => item.dir === 'ttb'
    || Math.abs(Math.sin(Math.atan2(transformed[1], transformed[0]) - angle)) > .2)) return fallback(content)
  const entries = transforms.map(({ item, rawIndex, transformed:t }) => {
    const x = t[4] * cos + t[5] * sin, y = -t[4] * sin + t[5] * cos
    const height = Math.max(1, Math.hypot(t[2], t[3]) || Number(item.height) * scale || 12)
    const width = Math.max(0, finite(item.width) ? Number(item.width) * scale : item.str.length * height * .5)
    return { item, rawIndex, x0:x, x1:x + width, y, height, top:y - height, bottom:y }
  })
  // Coordinates that overflowed to infinity cannot be ordered: keep the stream.
  if (!entries.every(entry => [entry.x0, entry.x1, entry.y, entry.height, entry.top, entry.bottom].every(Number.isFinite))) return fallback(content)
  const rtlWeight = entries.filter(entry => entry.item.dir === 'rtl').reduce((sum, entry) => sum + entry.item.str.length, 0)
  const rtl = rtlWeight > entries.reduce((sum, entry) => sum + entry.item.str.length, 0) / 2
  const lines = orderLines(pdfRowLines(entries, rtl), rtl)
  // Fail closed to the complete stream if a future layout rule loses or
  // duplicates an item. Reordering is never permission to discard a phrase.
  const orderedIndices = lines.flatMap(line => line.entries.map(entry => entry.rawIndex))
  if (orderedIndices.length !== raw.length || new Set(orderedIndices).size !== raw.length) return fallback(content)
  return assemblePDFLines(lines)
}
