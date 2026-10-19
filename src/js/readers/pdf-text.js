// PDF text items follow the order in which the file paints glyphs, which need
// not be its reading order. This page-local layout keeps every text item and
// its source offsets: the same result feeds reflow, speech and the text layer.
// No OCR, language model, repeated-line removal or guessed missing text.
import { assemblePDFLines } from './pdf-stream-wasm.js'
import { pdfOrderLines as orderLines } from './pdf-order-wasm.js'
import { PDF_TEXT_ITEM_LIMIT, pdfRowLines } from './pdf-row-layout-wasm.js'
import { readerUI } from './rust-ui-required.js'
import { coreRequired } from './core-required.js'
import { withArena } from './neural-voice/core-call.js'
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
  const core = getRustCore(), n = raw.length
  if (typeof core?.pdf_text_geometry_a !== 'function') return coreRequired(undefined)
  // Arena cells: view, items, requests, answers of rounds one and two, entries, rtl.
  const items = 6, requests = items + n * ITEM, first = requests + Math.max(3 * n + 1, n + 2) * 3, second = first + 3 * n + 1
  const entries = second + n + 2, rtl = entries + n * ENTRY
  return withArena(core, rtl + 1, pointer => {
    const at = cell => pointer + cell * 8, data = new Float64Array(core.memory.buffer, pointer, rtl + 1)
    data.set(view.map(Number))
    raw.forEach(({ item }, i) => {
      // Spread like the original check: a non-iterable transform still throws here.
      const base = items + i * ITEM, positioned = item.transform?.length === 6 && [...item.transform]
      for (let k = 0; k < 6; k++) data[base + k] = positioned ? Number(item.transform[k]) : NaN
      data.set([Number(item.width), Number(item.height), item.str.trim().length, item.str.length, directions[item.dir] || 0], base + 6)
    })
    const round = (status, answers) => {
      if (status < 0) throw new Error('PDF text geometry: invalid call')
      if (status && answers) resolveHostMath(core, at(requests), at(answers), status)
      return status
    }
    if (!round(core.pdf_text_geometry_a(at(0), at(items), n, at(requests)), first)
      || !round(core.pdf_text_geometry_b(at(0), at(items), n, at(first), at(requests)), second)
      || !round(core.pdf_text_geometry_finish(at(0), at(items), n, at(first), at(second), at(entries), at(rtl)))) return null
    const out = new Float64Array(core.memory.buffer, pointer, rtl + 1)
    return { rtl:out[rtl] === 1, entries:raw.map(({ item, rawIndex }, i) => {
      const [x0, x1, y, height, top, bottom] = out.subarray(entries + i * ENTRY, entries + (i + 1) * ENTRY)
      return { item, rawIndex, x0, x1, y, height, top, bottom }
    }) }
  })
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
