// PDF text items follow the order in which the file paints glyphs, which need
// not be its reading order. This page-local layout keeps every text item and
// its source offsets: the same result feeds reflow, speech and the text layer.
// No OCR, language model, repeated-line removal or guessed missing text.
import { pdfOrderLines as orderLines } from '../../../src/js/readers/pdf-order-lines.js'
import { pdfRowLines } from '../../../src/js/readers/pdf-row-layout-wasm.js'

const DEFAULT_VIEW = [1, 0, 0, -1, 0, 0]
const median = values => {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

const finite = value => Number.isFinite(Number(value))
const cjk = char => /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(char || '')
const listStart = text => /^(?:[•●▪‣⁃]|\d{1,3}[.)]|[a-z][.)])\s/u.test(text.trimStart())
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


function fragmentSeparator(previous, next, rtl) {
  const a = previous.item.str, b = next.item.str
  if (/\s$/.test(a) || /^\s/.test(b) || cjk(a.at(-1)) && cjk(b[0])) return ''
  const gap = rtl ? previous.x0 - next.x1 : next.x0 - previous.x1
  return gap <= Math.min(previous.height, next.height) * .12 ? '' : ' '
}

/** Page-local reading layout. Text without usable geometry keeps the legacy stream order verbatim. */
export function extractPDFText(content, viewport) {
  const raw = (content?.items || []).map((item, rawIndex) => ({ item, rawIndex }))
    .filter(({ item }) => typeof item.str === 'string' && item.str)
  if (!raw.length) return fallback(content || {})
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
  const rtlWeight = entries.filter(entry => entry.item.dir === 'rtl').reduce((sum, entry) => sum + entry.item.str.length, 0)
  const rtl = rtlWeight > entries.reduce((sum, entry) => sum + entry.item.str.length, 0) / 2
  const lines = orderLines(pdfRowLines(entries, rtl), rtl)
  // Fail closed to the complete stream if a future layout rule loses or
  // duplicates an item. Reordering is never permission to discard a phrase.
  const orderedIndices = lines.flatMap(line => line.entries.map(entry => entry.rawIndex))
  if (orderedIndices.length !== raw.length || new Set(orderedIndices).size !== raw.length) return fallback(content)
  const leadingByColumn = new Map()
  for (let index = 1; index < lines.length; index++) {
    const a = lines[index - 1], b = lines[index], delta = b.y - a.y
    if (a.column !== b.column || delta <= 0 || delta > Math.max(a.height, b.height) * 2.6) continue
    const values = leadingByColumn.get(b.column) || []
    values.push(delta); leadingByColumn.set(b.column, values)
  }
  // The lower half avoids letting a blank paragraph line redefine the normal
  // baseline spacing on a short page that has as many paragraphs as wraps.
  for (const [key, values] of leadingByColumn) {
    values.sort((a, b) => a - b)
    leadingByColumn.set(key, median(values.slice(0, Math.max(1, Math.ceil(values.length / 2)))))
  }
  let text = '', paragraphStart = 0
  const spans = [], items = [], paragraphs = []
  const closeParagraph = () => {
    if (text.length > paragraphStart) paragraphs.push({ start:paragraphStart, end:text.length, text:text.slice(paragraphStart) })
  }
  const append = (entry, trimSoftHyphen) => {
    const itemIndex = items.length
    items.push({ ...entry.item, hasEOL:false })
    let stop = entry.item.str.length
    if (trimSoftHyphen && entry.item.str.endsWith('\u00ad')) stop--
    if (!stop) return
    const start = text.length
    text += entry.item.str.slice(0, stop)
    spans.push({ itemIndex, rawIndex:entry.rawIndex, start, end:text.length, sourceStart:0, sourceEnd:stop })
  }
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index], previous = lines[index - 1]
    if (previous) {
      const normal = leadingByColumn.get(line.column) || Math.max(previous.height, line.height) * 1.5
      const delta = line.y - previous.y
      const breakParagraph = line.column !== previous.column || delta < 0
        || delta > normal + Math.max(2, Math.min(previous.height, line.height) * .3)
        || listStart(line.text)
      if (breakParagraph) { closeParagraph(); text += '\n\n'; paragraphStart = text.length }
      else if (!/\s$/.test(text) && !/^\s/.test(line.entries[0].item.str)) {
        // A visible hard hyphen may be a real compound: retain it. Only a
        // discretionary soft hyphen is removed. Neither loses spoken letters.
        const continued = /[-‐]$/.test(text) && /^\p{Ll}/u.test(line.entries[0].item.str)
        if (!continued && !previous.softHyphen && !(cjk(text.at(-1)) && cjk(line.entries[0].item.str[0]))) text += ' '
      }
    }
    const firstOffset = text.length
    for (let piece = 0; piece < line.entries.length; piece++) {
      if (piece) text += fragmentSeparator(line.entries[piece - 1], line.entries[piece], line.rtl)
      const next = lines[index + 1]
      const softHyphen = piece === line.entries.length - 1 && next?.column === line.column
        && /^\p{Ll}/u.test(next.entries[0].item.str) && line.entries[piece].item.str.endsWith('\u00ad')
      if (softHyphen) line.softHyphen = true
      append(line.entries[piece], softHyphen)
    }
    items.at(-1).hasEOL = true
    line.text = text.slice(firstOffset); line.start = firstOffset; line.end = text.length
    line.sourceIndices = line.entries.map(entry => entry.rawIndex)
  }
  closeParagraph()
  return { geometric:true, text, items, spans, lines, paragraphs }
}

/** Maps the reordered PDF.js spans to the same joined text that reflow speaks. */
export function mapPDFTextLayer(layer, layout) {
  if (!layout?.geometric) return null
  const doc = layer.ownerDocument, walker = doc.createTreeWalker(layer, 4), nodes = []
  for (let node = walker.nextNode(); node; node = walker.nextNode()) if (node.nodeValue) nodes.push(node)
  const nonEmptyItems = layout.items.filter(item => item.str)
  if (nodes.length !== nonEmptyItems.length || nodes.some((node, index) => node.nodeValue !== nonEmptyItems[index].str)) return null
  const spans = layout.spans.map(span => ({ ...span, node:nodes[span.itemIndex] }))
  const spanAt = offset => {
    let lo = 0, hi = spans.length - 1, found = -1
    while (lo <= hi) { const mid = (lo + hi) >>> 1; if (spans[mid].start <= offset) { found = mid; lo = mid + 1 } else hi = mid - 1 }
    return found
  }
  return {
    text:layout.text, spans,
    rangeFor(start, end) {
      if (!(end > start) || !spans.length) return null
      let a = spanAt(start), b = spanAt(end - 1)
      if (a < 0) a = 0
      else if (start >= spans[a].end) a++
      if (b < a || b < 0 || a >= spans.length) return null
      const first = spans[a], last = spans[b], range = doc.createRange()
      range.setStart(first.node, first.sourceStart + Math.max(0, start - first.start))
      range.setEnd(last.node, last.sourceStart + Math.min(last.end - last.start, end - last.start))
      return range
    },
    offsetOf(node, offset) {
      const matching = spans.filter(span => span.node === node)
      const span = matching.find(value => offset <= value.sourceEnd) || matching.at(-1)
      return span ? span.start + Math.max(0, Math.min(span.end - span.start, offset - span.sourceStart)) : 0
    }
  }
}
