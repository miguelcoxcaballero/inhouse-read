// Frozen JavaScript originals of the PDF column-cut and row-grouping kernels, as
// they stood in src/js/readers (pdf-layout-wasm.js and pdf-row-layout-wasm.js)
// before the compiled Rust core became their only implementation. Tests only:
// the differential suites compare the Rust kernels with these, bit for bit.

export function legacyPDFColumnCut(lines) {
  if (lines.length < 4) return null
  const heights = lines.map(line => line.height).sort((a, b) => a - b)
  const height = heights[Math.floor(heights.length / 2)]
  const edges = [...new Set(lines.flatMap(line => [line.x0, line.x1]))].sort((a, b) => a - b)
  let best, table = false
  for (let index = 1; index < edges.length; index++) {
    if (edges[index] - edges[index - 1] < height * .65) continue
    const at = (edges[index] + edges[index - 1]) / 2
    const left = [], right = [], crossing = []
    for (const line of lines) (line.x1 <= at ? left : line.x0 >= at ? right : crossing).push(line)
    if (left.length < 2 || right.length < 2 || crossing.length > Math.min(left.length, right.length)) continue
    const overlap = Math.min(Math.max(...left.map(line => line.bottom)), Math.max(...right.map(line => line.bottom)))
      - Math.max(Math.min(...left.map(line => line.top)), Math.min(...right.map(line => line.top)))
    if (overlap < height * 1.5) continue
    const coexisting = left.filter(line => right.some(other => Math.abs(other.y - line.y) < Math.max(line.height, other.height) * 1.6)).length
    if (coexisting < 2) continue
    // A tightly aligned matrix of short cells is much more likely a table
    // than wrapped prose. Keep its row order instead of reading each field's
    // column from top to bottom. Long prose lines still admit narrow gutters.
    const cells = [...left, ...right]
    const aligned = left.filter(line => right.some(other => Math.abs(other.y - line.y) < Math.min(line.height, other.height) * .25)).length
    if (crossing.length <= 2 && left.length >= 3 && right.length >= 3 && aligned >= left.length * .85
      && cells.filter(line => line.x1 - line.x0 < line.height * 8).length >= cells.length * .85) { table = true; continue }
    const gap = Math.min(...right.map(line => line.x0)) - Math.max(...left.map(line => line.x1))
    if (gap < height * .65) continue
    const score = coexisting * Math.min(left.length, right.length) * Math.min(gap, height * 8) / (crossing.length + 1)
    if (!best || score > best.score) best = { at, left, right, crossing, score }
  }
  return best || (table ? { table:true } : null)
}


const textMedian = (entries, key) => {
  const sorted = [...entries].sort((a, b) => a[key] - b[key])
  const total = sorted.reduce((sum, entry) => sum + Math.max(1, entry.item.str.trim().length), 0)
  let weight = 0
  for (const entry of sorted) {
    weight += Math.max(1, entry.item.str.trim().length)
    if (weight >= total / 2) return entry[key]
  }
  return sorted.at(-1)?.[key] || 0
}
function makeRows(entries) {
  const rows = [], maxHeight = Math.max(...entries.map(entry => entry.height))
  for (const entry of [...entries].sort((a, b) => a.top - b.top || a.x0 - b.x0 || a.rawIndex - b.rawIndex)) {
    let chosen, distance = Infinity
    for (let index = rows.length - 1; index >= 0; index--) {
      const row = rows[index]
      if (row.bottom < entry.top - maxHeight * .5) break
      const overlap = Math.min(row.bottom, entry.bottom) - Math.max(row.top, entry.top)
      const delta = Math.abs(row.y - entry.y)
      if ((delta <= Math.max(row.height, entry.height) * .42
        || overlap >= Math.min(row.height, entry.height) * .65) && delta < distance) {
        chosen = row; distance = delta
      }
    }
    if (!chosen) {
      rows.push({ entries:[entry], y:entry.y, top:entry.top, bottom:entry.bottom, height:entry.height })
    } else {
      chosen.entries.push(entry)
      chosen.top = Math.min(chosen.top, entry.top); chosen.bottom = Math.max(chosen.bottom, entry.bottom)
      // Superscript note markers and drop caps must not move a whole line's
      // baseline or pretend that its regular neighbours have a huge leading.
      chosen.y = textMedian(chosen.entries, 'y')
      chosen.height = textMedian(chosen.entries, 'height')
    }
  }
  return rows
}

function segmentRows(rows, rtl) {
  const lines = []
  for (const row of rows) {
    const sorted = [...row.entries].sort((a, b) => a.x0 - b.x0 || a.rawIndex - b.rawIndex)
    let group = []
    const finish = () => {
      if (!group.length) return
      const rtlWeight = group.filter(entry => entry.item.dir === 'rtl').reduce((sum, entry) => sum + entry.item.str.length, 0)
      const lineRTL = rtlWeight > group.reduce((sum, entry) => sum + entry.item.str.length, 0) / 2
      const entries = lineRTL ? [...group].reverse() : group
      lines.push({ entries, x0:Math.min(...group.map(entry => entry.x0)), x1:Math.max(...group.map(entry => entry.x1)),
        y:row.y, top:row.top, bottom:row.bottom, height:row.height,
        text:entries.map(entry => entry.item.str).join(''), rtl:lineRTL })
      group = []
    }
    for (const entry of sorted) {
      const last = group.at(-1)
      // A word space stays within a line; a substantial empty gutter can be
      // a column. The page-level test below requires repeated, coexisting
      // left and right lines before it treats that gap as a column boundary.
      if (last && entry.x0 - last.x1 > Math.max(last.height, entry.height) * 2) finish()
      group.push(entry)
    }
    finish()
  }
  return lines
}

export function legacyPDFRowLines(entries, rtl) { return segmentRows(makeRows(entries), rtl) }
