import {pdfColumnCut as columnCut} from './pdf-layout-wasm.js'
import {rustPDFOrderLines} from './pdf-order-wasm.js'

const median = values => {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

export function legacyPDFOrderLines(lines, rtl, path = '', depth = 0) {
  if (lines.length < 2) return lines.map(line => ({ ...line, column:path }))
  if (depth > 32) return [...lines].sort((a, b) => a.y - b.y || (rtl ? b.x0 - a.x0 : a.x0 - b.x0))
    .map(line => ({ ...line, column:path }))
  const cut = columnCut(lines)
  if (cut?.table) return [...lines].sort((a, b) => a.y - b.y || (rtl ? b.x0 - a.x0 : a.x0 - b.x0))
    .map(line => ({ ...line, column:path }))
  if (cut) {
    const result = [], remaining = [...cut.left, ...cut.right]
    const bodyTop = Math.max(Math.min(...cut.left.map(line => line.y)), Math.min(...cut.right.map(line => line.y)))
    const bodyBottom = Math.min(Math.max(...cut.left.map(line => line.y)), Math.max(...cut.right.map(line => line.y)))
    const counters = remaining.filter(line => /^\s*(?:\d{1,5}|[ivxlcdm]{1,7})\s*$/i.test(line.text)
      && (line.y < bodyTop - line.height * 1.5 || line.y > bodyBottom + line.height * 1.5))
    for (const line of counters) remaining.splice(remaining.indexOf(line), 1)
    result.push(...counters.filter(line => line.y < bodyTop).sort((a, b) => a.y - b.y).map(line => ({ ...line, column:`${path}/header` })))
    const appendColumns = group => {
      const left = group.filter(line => line.x1 <= cut.at), right = group.filter(line => line.x0 >= cut.at)
      const columns = rtl ? [[right, 'r'], [left, 'l']] : [[left, 'l'], [right, 'r']]
      for (const [column, side] of columns) result.push(...legacyPDFOrderLines(column, rtl, `${path}/${side}`, depth + 1))
    }
    // Full-width chapter titles/figures interrupt both columns. Read complete
    // columns in each band, never alternate their lines by their Y coordinate.
    for (const full of [...cut.crossing].sort((a, b) => a.y - b.y || a.x0 - b.x0)) {
      const preceding = remaining.filter(line => line.y < full.y - full.height * .3)
      appendColumns(preceding)
      for (const line of preceding) remaining.splice(remaining.indexOf(line), 1)
      result.push({ ...full, column:`${path}/span-${result.length}` })
    }
    appendColumns(remaining)
    result.push(...counters.filter(line => line.y > bodyBottom).sort((a, b) => a.y - b.y).map(line => ({ ...line, column:`${path}/footer` })))
    return result
  }
  // A full-width section before/after a column layout can hide its gutter.
  // Empty horizontal bands expose that local layout without inventing a cut
  // through a line. In ordinary prose this simply retains top-to-bottom order.
  const topDown = [...lines].sort((a, b) => a.top - b.top || a.x0 - b.x0)
  let bottom = topDown[0].bottom, split = -1, widest = 0
  const height = median(lines.map(line => line.height))
  for (let index = 1; index < topDown.length; index++) {
    const gap = topDown[index].top - bottom
    if (gap > widest && gap > height * .45) { widest = gap; split = index }
    bottom = Math.max(bottom, topDown[index].bottom)
  }
  if (split > 0) return [...legacyPDFOrderLines(topDown.slice(0, split), rtl, path, depth + 1), ...legacyPDFOrderLines(topDown.slice(split), rtl, path, depth + 1)]
  return topDown.sort((a, b) => a.y - b.y || (rtl ? b.x0 - a.x0 : a.x0 - b.x0)).map(line => ({ ...line, column:path }))
}

// Small pages avoid boundary copies; the pure implementation remains available
// when the optional kernel is absent or rejects a page.
export function pdfOrderLines(lines,rtl){
  const accelerated=lines.length>=32?rustPDFOrderLines(lines,rtl):undefined;
  return accelerated??legacyPDFOrderLines(lines,rtl);
}
