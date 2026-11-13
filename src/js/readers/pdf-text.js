// PDF text items follow the order in which the file paints glyphs, which need
// not be its reading order. This page-local layout keeps every text item and
// its source offsets: the same result feeds reflow, speech and the text layer.
// No OCR, language model, repeated-line removal or guessed missing text.
//
// The whole page is one pass through rust-core: the item geometry (two rounds of the engine's own
// Math, pdf_text_geometry.rs) and then rows, reading order and the joined stream in a single call
// (pdf_page_text.rs). What stays here is what only the engine has: the item objects, their strings
// and the browser's Unicode properties of each item's first and last character.
import { readerUI } from './rust-ui-required.js'
import { coreRequired } from './core-required.js'
import { getRustCore } from '../rust-core.js'
import { resolveHostMath } from '../host-math.js'

const DEFAULT_VIEW = [1, 0, 0, -1, 0, 0]
const finite = value => Number.isFinite(Number(value))
// The most text items of one page the kernels order (the stream keeps the rest).
export const PDF_TEXT_ITEM_LIMIT = 32768
const ITEM = 11, OUT_ENTRY = 11, OUT_LINE = 14, directions = { ttb:1, rtl:2 }, decoder = new TextDecoder()

function fallback(content) {
  return { geometric:false, items:content.items || [], lines:[], paragraphs:[], spans:[],
    text:(content.items || []).filter(item => typeof item.str === 'string')
      .map(item => item.str + (item.hasEOL ? '\n' : ' ')).join('') }
}

const cjk = char => /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(char || '')
// Cache only Unicode classifications of bounded boundary characters. Use the
// browser's properties, including its UTF-16 treatment of CJK endpoints.
const starts = new Map(), ends = new Map()
function flags(text) {
  const first = text.slice(0, text.codePointAt(0) > 0xffff ? 2 : 1), last = text.at(-1) || ''
  let a = starts.get(first), b = ends.get(last)
  if (a === undefined) { a = (/^\s/.test(first) ? 1 : 0) | (/^\p{Ll}/u.test(first) ? 4 : 0) | (cjk(first[0]) ? 8 : 0); if (starts.size >= 512) starts.clear(); starts.set(first, a) }
  if (b === undefined) { b = (/\s$/.test(last) ? 2 : 0) | (cjk(last) ? 16 : 0) | (/[-‐]/.test(last) ? 32 : 0) | (last === '­' ? 64 : 0); if (ends.size >= 512) ends.clear(); ends.set(last, b) }
  return a | b
}

// One arena of eight-byte cells serves every page of a book; a page too large to keep (256 KiB)
// gets its own and returns it.
const RETAINED = 32768
let kept = null
function acquire(core, cells) {
  if (kept?.core === core && kept.cells >= cells) return kept
  if (kept) { kept.core.free_f64(kept.pointer, kept.cells); kept = null }
  let capacity = cells
  if (cells <= RETAINED) { capacity = 1024; while (capacity < cells) capacity *= 2 }
  const pointer = core.alloc_f64(capacity)
  if (!pointer) throw new Error('Rust core: no memory for the call')
  const arena = { core, pointer, cells:capacity }
  if (cells <= RETAINED) kept = arena
  return arena
}

/** Page-local reading layout. Text without usable geometry keeps the legacy stream order verbatim. */
export function extractPDFText(content, viewport) {
  const items = [], raw = []
  let units = 0
  ;(content?.items || []).forEach((item, rawIndex) => {
    if (typeof item.str === 'string' && item.str) { items.push(item); raw.push(rawIndex); units += item.str.length }
  })
  const n = items.length
  if (!n) return fallback(content || {})
  // The kernels order up to this many text items; a page with more keeps the
  // complete stream in the order the file paints it.
  if (n > PDF_TEXT_ITEM_LIMIT) return fallback(content)
  const view = Array.isArray(viewport?.transform) && viewport.transform.length === 6 && viewport.transform.every(finite)
    ? viewport.transform : DEFAULT_VIEW
  const core = getRustCore()
  if (typeof core?.pdf_page_text !== 'function') return coreRequired(undefined)
  // Arena cells: view, items, requests, answers of rounds one and two, the stream's item facts,
  // the answer's header and every item's UTF-16 text.
  const itemsAt = 6, requests = itemsAt + n * ITEM, first = requests + Math.max(3 * n + 1, n + 2) * 3, second = first + 3 * n + 1
  const extraAt = second + n + 2, header = extraAt + n * 3, textAt = header + 4
  const arena = acquire(core, textAt + Math.ceil(units / 4)), pointer = arena.pointer, at = cell => pointer + cell * 8
  try {
    const data = new Float64Array(core.memory.buffer, pointer, requests)
    for (let k = 0; k < 6; k++) data[k] = Number(view[k])
    for (let i = 0; i < n; i++) {
      // Spread like the original check: a non-iterable transform still throws here.
      const item = items[i], base = itemsAt + i * ITEM, positioned = item.transform?.length === 6 && [...item.transform]
      for (let k = 0; k < 6; k++) data[base + k] = positioned ? Number(item.transform[k]) : NaN
      data[base + 6] = Number(item.width); data[base + 7] = Number(item.height)
      data[base + 8] = item.str.trim().length; data[base + 9] = item.str.length; data[base + 10] = directions[item.dir] || 0
    }
    const round = (status, answers) => {
      if (status < 0) throw new Error('PDF text geometry: invalid call')
      if (status) resolveHostMath(core, at(requests), at(answers), status)
      return status
    }
    // null geometry keeps the stream order (partial, vertical, mixed-rotation or overflowing).
    if (!round(core.pdf_text_geometry_a(at(0), at(itemsAt), n, at(requests)), first)
      || !round(core.pdf_text_geometry_b(at(0), at(itemsAt), n, at(first), at(requests)), second)) return fallback(content)
    const extra = new Float64Array(core.memory.buffer, at(extraAt), n * 3), codes = new Uint16Array(core.memory.buffer, at(textAt), units)
    for (let i = 0, unit = 0; i < n; i++) {
      const text = items[i].str, size = text.length
      extra[i * 3] = raw[i]; extra[i * 3 + 1] = flags(text); extra[i * 3 + 2] = text.endsWith('­') ? flags(text.slice(0, -1)) : 0
      for (let k = 0; k < size; k++) codes[unit++] = text.charCodeAt(k)
    }
    const status = core.pdf_page_text(at(0), at(itemsAt), n, at(first), at(second), at(extraAt), at(textAt), units, at(header))
    if (status === -1) throw new Error('PDF text geometry: invalid call')
    if (!status) return fallback(content)
    // A stage that rejected its input: fail closed, reordering is never permission to discard a phrase.
    if (status !== 1) return coreRequired(undefined)
    // Views made after the call: the memory may have grown.
    const [answer, count, size, pathBytes] = new Float64Array(core.memory.buffer, at(header), 4)
    const out = new Float64Array(core.memory.buffer, answer, n * OUT_ENTRY + count * OUT_LINE)
    const paths = decoder.decode(new Uint8Array(core.memory.buffer, answer + out.length * 8, pathBytes))
    const lines = [], outItems = [], spans = [], paragraphs = [], parts = []
    let e = 0, l = n * OUT_ENTRY, position = 0, paragraphStart = 0
    for (let i = 0; i < count; i++, l += OUT_LINE) {
      const pieces = out[l], entries = new Array(pieces), sourceIndices = []
      if (out[l + 13]) {
        if (position > paragraphStart) paragraphs.push({ start:paragraphStart, end:position })
        paragraphStart = position + 2
      }
      for (let piece = 0; piece < pieces; piece++, e += OUT_ENTRY) {
        const item = items[out[e]], rawIndex = raw[out[e]], prefix = out[e + 7], text = item.str, stop = text.length - out[e + 8]
        entries[piece] = { item, rawIndex, x0:out[e + 1], x1:out[e + 2], y:out[e + 3], height:out[e + 4], top:out[e + 5], bottom:out[e + 6] }
        sourceIndices.push(rawIndex)
        if (prefix) parts.push(prefix === 2 ? '\n\n' : ' ')
        if (stop) {
          parts.push(text.slice(0, stop))
          spans.push({ itemIndex:outItems.length, rawIndex, start:out[e + 9], end:out[e + 10], sourceStart:0, sourceEnd:stop })
        }
        outItems.push({ ...item, hasEOL:piece === pieces - 1 })
      }
      position = out[l + 11]
      const line = { entries, x0:out[l + 1], x1:out[l + 2], y:out[l + 3], top:out[l + 4], bottom:out[l + 5], height:out[l + 6], text:'', rtl:out[l + 7] === 1,
        column:paths.slice(out[l + 8], out[l + 8] + out[l + 9]), start:out[l + 10], end:position, sourceIndices }
      if (out[l + 12]) line.softHyphen = true
      lines.push(line)
    }
    if (position !== size) return coreRequired(undefined)
    if (position > paragraphStart) paragraphs.push({ start:paragraphStart, end:position })
    // Join once. Slicing a growing rope at every line repeatedly flattens all
    // preceding text; long illustrated/scanned pages otherwise become quadratic.
    const text = parts.join('')
    for (const paragraph of paragraphs) paragraph.text = text.slice(paragraph.start, paragraph.end)
    for (const line of lines) line.text = text.slice(line.start, line.end)
    return { geometric:true, text, items:outItems, spans, lines, paragraphs }
  } finally { if (arena !== kept) core.free_f64(pointer, arena.cells) }
}

/** Maps the reordered PDF.js spans to the same joined text that reflow speaks. */
export function mapPDFTextLayer(layer, layout) {
  const ui = readerUI(), map = ui.pdf_layer_map(layer, layout)
  return map && { text:map.text, spans:map.spans,
    rangeFor:(start, end) => ui.pdf_layer_range(map.doc, map.spans, start, end),
    offsetOf:(node, offset) => ui.pdf_layer_offset(map.spans, node, offset) }
}
