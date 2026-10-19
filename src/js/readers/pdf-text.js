// PDF text items follow the order in which the file paints glyphs, which need
// not be its reading order. This page-local layout keeps every text item and
// its source offsets: the same result feeds reflow, speech and the text layer.
// No OCR, language model, repeated-line removal or guessed missing text.
import { assemblePDFLines } from './pdf-stream-wasm.js'
import { pdfOrderLines as orderLines } from './pdf-order-wasm.js'
import { PDF_TEXT_ITEM_LIMIT, pdfRowLines } from './pdf-row-layout-wasm.js'
import { readerUI } from './rust-ui-required.js'
import { coreRequired } from './core-required.js'
import { getRustCore } from '../rust-core.js'
import { resolveHostMath } from '../host-math.js'

const DEFAULT_VIEW = [1, 0, 0, -1, 0, 0]
const finite = value => Number.isFinite(Number(value))
const ITEM = 11, ENTRY = 6, directions = { ttb:1, rtl:2 }

function fallback(content) {
  return { geometric:false, items:content.items || [], lines:[], paragraphs:[], spans:[],
    text:(content.items || []).filter(item => typeof item.str === 'string')
      .map(item => item.str + (item.hasEOL ? '\n' : ' ')).join('') }
}

// The geometry of the items (viewport transform, dominant direction, rotation and boxes) is
// rust-core pdf_text_geometry.rs; the engine's own Math answers its three rounds of arctangents,
// hypotenuses, sines and cosines. Strings, trimming and the item objects stay here. null keeps
// the stream order (partial, vertical, mixed-rotation or overflowing geometry).
function itemGeometry(raw, view) {
  const core = getRustCore(), count = raw.length
  if (typeof core?.pdf_text_geometry_a !== 'function') return coreRequired(undefined)
  const firstCount = 3 * count + 1, at = { view:0, items:6, requests:6 + count * ITEM }
  at.first = at.requests + Math.max(firstCount, count + 2) * 3; at.second = at.first + firstCount
  at.entries = at.second + count + 2; at.rtl = at.entries + count * ENTRY
  const length = at.rtl + 1, pointer = core.alloc_f64(length), cell = name => pointer + at[name] * 8
  if (!pointer) throw new Error('PDF text geometry: no memory for the page')
  const check = status => { if (status < 0) throw new Error('PDF text geometry: invalid call'); return status }
  try {
    let data = new Float64Array(core.memory.buffer, pointer, length)
    data.set(view.map(Number), at.view)
    raw.forEach(({ item }, index) => {
      // Spread like the original check: a non-iterable transform still throws here.
      const positioned = item.transform?.length === 6 && [...item.transform], base = at.items + index * ITEM
      for (let k = 0; k < 6; k++) data[base + k] = positioned ? Number(item.transform[k]) : NaN
      data[base + 6] = Number(item.width); data[base + 7] = Number(item.height)
      data[base + 8] = item.str.trim().length; data[base + 9] = item.str.length; data[base + 10] = directions[item.dir] || 0
    })
    const asked = check(core.pdf_text_geometry_a(cell('view'), cell('items'), count, cell('requests')))
    if (!asked) return null
    resolveHostMath(core, cell('requests'), cell('first'), asked)
    const again = check(core.pdf_text_geometry_b(cell('view'), cell('items'), count, cell('first'), cell('requests')))
    if (!again) return null
    resolveHostMath(core, cell('requests'), cell('second'), again)
    if (!check(core.pdf_text_geometry_finish(cell('view'), cell('items'), count, cell('first'), cell('second'), cell('entries'), cell('rtl')))) return null
    data = new Float64Array(core.memory.buffer, pointer, length)
    const entries = raw.map(({ item, rawIndex }, index) => {
      const base = at.entries + index * ENTRY
      return { item, rawIndex, x0:data[base], x1:data[base + 1], y:data[base + 2], height:data[base + 3], top:data[base + 4], bottom:data[base + 5] }
    })
    return { entries, rtl:data[at.rtl] === 1 }
  } finally { core.free_f64(pointer, length) }
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
  const geometry = itemGeometry(raw, view)
  if (!geometry) return fallback(content)
  const lines = orderLines(pdfRowLines(geometry.entries), geometry.rtl)
  // Fail closed to the complete stream if a future layout rule loses or
  // duplicates an item. Reordering is never permission to discard a phrase.
  const orderedIndices = lines.flatMap(line => line.entries.map(entry => entry.rawIndex))
  if (orderedIndices.length !== raw.length || new Set(orderedIndices).size !== raw.length) return fallback(content)
  return assemblePDFLines(lines)
}

/** Maps the reordered PDF.js spans to the same joined text that reflow speaks. */
export function mapPDFTextLayer(layer, layout) {
  const ui = readerUI(), map = ui.pdf_layer_map(layer, layout)
  return map && { text:map.text, spans:map.spans,
    rangeFor:(start, end) => ui.pdf_layer_range(map.doc, map.spans, start, end),
    offsetOf:(node, offset) => ui.pdf_layer_offset(map.spans, node, offset) }
}
