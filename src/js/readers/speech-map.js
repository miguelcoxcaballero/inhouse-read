// DOM side of the audiobook: the text of a document (or element) together with
// the exact text nodes it came from. The text is the concatenation of the text
// nodes plus ONE synthetic "\n" where a block ends or a <br> sits, so raw
// offsets map back to (node, offset) without guessing and no node is touched.

import { HARD_BREAK } from './speech-text.js'

const SHOW_ELEMENT = 1, SHOW_TEXT = 4, REJECT = 2
const SKIPPED = new Set(['script', 'style', 'noscript', 'template', 'head', 'title', 'rt', 'rp', 'svg', 'math'])
const BLOCKS = new Set(['address', 'article', 'aside', 'blockquote', 'dd', 'details', 'div', 'dl', 'dt', 'fieldset', 'figcaption', 'figure',
  'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'li', 'main', 'nav', 'ol', 'p', 'pre', 'section', 'summary', 'table',
  'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'ul', 'body', 'html'])

// Blocks that are sentences by themselves: a heading or list item rarely ends in a full stop.
const HARD_BLOCKS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'dt', 'dd', 'th', 'td', 'caption', 'figcaption', 'summary'])

/** Text of `root` in reading order plus the span table that maps offsets back to its text nodes. */
export function mapSpeechText(root) {
  const doc = root.ownerDocument || root
  const walker = doc.createTreeWalker(root, SHOW_ELEMENT | SHOW_TEXT, { acceptNode: node => node.nodeType === 1 && SKIPPED.has(node.localName) ? REJECT : 1 })
  const spans = []
  let text = '', pending = false, lastBlock = null
  const blockOf = node => { let el = node.parentElement; while (el && el !== root && !BLOCKS.has(el.localName)) el = el.parentElement; return el }
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeType === 1) { if (node.localName === 'br') pending = true; continue }
    const value = node.nodeValue
    if (!value) continue
    const block = blockOf(node)
    if (text && (pending || block !== lastBlock)) text += HARD_BLOCKS.has(block?.localName) || HARD_BLOCKS.has(lastBlock?.localName) ? HARD_BREAK : '\n'
    pending = false; lastBlock = block
    spans.push({ node, start:text.length, end:text.length + value.length })
    text += value
  }
  return { text, spans, ...locators(doc, spans) }
}

/** Same mapping for a PDF.js text layer: one node per text item, a space between items, "\n" at <br> line ends. */
export function mapTextLayer(layer) {
  const doc = layer.ownerDocument
  const walker = doc.createTreeWalker(layer, SHOW_ELEMENT | SHOW_TEXT)
  const spans = []
  let text = '', separator = ' '
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeType === 1) { if (node.localName === 'br') separator = '\n'; continue }
    if (!node.nodeValue) continue
    if (text) text += separator
    separator = ' '
    spans.push({ node, start:text.length, end:text.length + node.nodeValue.length })
    text += node.nodeValue
  }
  return { text, spans, ...locators(doc, spans) }
}

/** A single text node (PDF reflow page) is its own identity mapping. */
export function mapTextNode(node) {
  const spans = node?.nodeValue ? [{ node, start:0, end:node.nodeValue.length }] : []
  return { text:node?.nodeValue || '', spans, ...locators(node?.ownerDocument, spans) }
}

function locators(doc, spans) {
  // Last span whose start is <= offset (spans are sorted and disjoint).
  const spanAt = offset => {
    let low = 0, high = spans.length - 1, found = -1
    while (low <= high) { const mid = (low + high) >> 1; if (spans[mid].start <= offset) { found = mid; low = mid + 1 } else high = mid - 1 }
    return found
  }
  return {
    /** DOM Range for raw [start, end), or null when it covers no text; synthetic separators are skipped. */
    rangeFor(start, end) {
      if (!spans.length || !(end > start)) return null
      let a = spanAt(start), b = spanAt(end - 1)
      if (a < 0) a = 0
      else if (start >= spans[a].end) a++
      if (b < 0 || a >= spans.length || b < a) return null
      const range = doc.createRange()
      range.setStart(spans[a].node, Math.max(0, start - spans[a].start))
      range.setEnd(spans[b].node, Math.min(spans[b].node.nodeValue.length, end - spans[b].start))
      return range
    },
    /** Raw offset of a DOM boundary point (the visible page's first character); element containers are fine. */
    offsetOf(container, offset) {
      if (!spans.length) return 0
      const point = doc.createRange()
      point.setStart(container, offset); point.collapse(true)
      let low = 0, high = spans.length
      // First span ending after the point.
      while (low < high) {
        const mid = (low + high) >> 1, { node } = spans[mid]
        if (point.comparePoint(node, node.nodeValue.length) > 0) high = mid; else low = mid + 1
      }
      if (low >= spans.length) return spans.at(-1).end
      const span = spans[low]
      return span.node === container ? span.start + offset : span.start
    }
  }
}
