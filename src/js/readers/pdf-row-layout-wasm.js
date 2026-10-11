import { getRustCore } from '../rust-core.js'

const INPUT_STRIDE = 10, LINE_STRIDE = 9, ITEM_LIMIT = 32768
// Keep small pages on the existing path. Complete extraction observations at
// 128+ items include the boundary copies; direct parity checks cover all sizes.
export const PDF_ROW_MIN_ITEMS = 128
const MAX_RETAINED_ELEMENTS = 32768 // 256 KiB; larger pages release immediately.
let retained = null
function acquire(core, length) {
  if (retained && retained.core !== core && !retained.inUse) {
    retained.core.free_f64(retained.pointer, retained.length); retained = null
  }
  if (retained?.core === core && !retained.inUse && retained.length >= length) {
    retained.inUse = true; return retained
  }
  const keep = length <= MAX_RETAINED_ELEMENTS && !retained?.inUse
  if (keep && retained) { retained.core.free_f64(retained.pointer, retained.length); retained = null }
  let capacity = length
  if (keep) { capacity = 32; while (capacity < length) capacity *= 2 }
  const pointer = core.alloc_f64(capacity)
  if (!pointer) return null
  const arena = { core, pointer, length:capacity, inUse:true }
  if (keep) retained = arena
  return arena
}
function release(arena, discard) {
  if (arena === retained && !discard) { arena.inUse = false; return }
  if (arena === retained) retained = null
  arena.core.free_f64(arena.pointer, arena.length)
}

// This accepts the normalized plain entry records constructed by pdf-text.js,
// not arbitrary descriptors/proxies. Strings and item metadata stay in JS.
// undefined alone requests the original implementation; [] is a valid page.
export function rustPDFRowLines(entries) {
  const count = entries.length
  if (!count) return []
  const core = getRustCore()
  if (!Number.isInteger(count) || count > ITEM_LIMIT || typeof core?.pdf_row_lines !== 'function'
    || !core.memory || typeof core.alloc_f64 !== 'function' || typeof core.free_f64 !== 'function') return undefined
  const inputLength = count * INPUT_STRIDE, orderLength = count
  const lineOffset = inputLength + orderLength, length = lineOffset + count * LINE_STRIDE
  let arena, failed = false
  try {
    arena = acquire(core, length)
    if (!arena) return undefined
    const { pointer } = arena
    const input = new Float64Array(core.memory.buffer, pointer, inputLength)
    for (let index = 0; index < count; index++) {
      const { x0, x1, y, height, top, bottom, rawIndex, item } = entries[index]
      if (!Number.isFinite(x0) || !Number.isFinite(x1) || !Number.isFinite(y) || !Number.isFinite(height)
        || !Number.isFinite(top) || !Number.isFinite(bottom) || height <= 0 || x1 < x0 || bottom < top
        || !Number.isSafeInteger(rawIndex) || rawIndex < 0 || typeof item?.str !== 'string') return undefined
      const at = index * INPUT_STRIDE
      input[at] = x0; input[at + 1] = x1; input[at + 2] = y; input[at + 3] = height
      input[at + 4] = top; input[at + 5] = bottom; input[at + 6] = rawIndex
      input[at + 7] = Math.max(1, item.str.trim().length)
      input[at + 8] = item.str.length; input[at + 9] = item.dir === 'rtl' ? 1 : 0
    }
    const linesCount = core.pdf_row_lines(pointer, count, pointer + inputLength * 8, pointer + lineOffset * 8)
    if (!Number.isInteger(linesCount) || linesCount < 1 || linesCount > count) { failed = true; return undefined }
    // Rust temporary vectors may grow memory; never retain the pre-call view.
    const order = new Float64Array(core.memory.buffer, pointer + inputLength * 8, count)
    const metadata = new Float64Array(core.memory.buffer, pointer + lineOffset * 8, linesCount * LINE_STRIDE)
    const seen = new Uint8Array(count), lines = []
    let expectedStart = 0
    for (let line = 0; line < linesCount; line++) {
      const at = line * LINE_STRIDE, start = metadata[at], size = metadata[at + 1]
      const x0 = metadata[at + 2], x1 = metadata[at + 3], y = metadata[at + 4]
      const top = metadata[at + 5], bottom = metadata[at + 6], height = metadata[at + 7], direction = metadata[at + 8]
      if (start !== expectedStart || !Number.isInteger(size) || size < 1 || start + size > count
        || !Number.isFinite(x0) || !Number.isFinite(x1) || !Number.isFinite(y) || !Number.isFinite(top)
        || !Number.isFinite(bottom) || !Number.isFinite(height) || height <= 0 || x1 < x0 || bottom < top
        || (direction !== 0 && direction !== 1)) { failed = true; return undefined }
      const group = new Array(size)
      for (let offset = 0; offset < size; offset++) {
        const original = order[start + offset]
        if (!Number.isInteger(original) || original < 0 || original >= count || seen[original]) { failed = true; return undefined }
        seen[original] = 1; group[offset] = entries[original]
      }
      lines.push({ entries:group, x0, x1, y, top, bottom, height,
        text:group.map(entry => entry.item.str).join(''), rtl:direction === 1 })
      expectedStart += size
    }
    if (expectedStart !== count) { failed = true; return undefined }
    return lines
  } catch { failed = true; return undefined }
  finally { if (arena) release(arena, failed) }
}

export function pdfRowLines(entries, rtl) {
  if (entries.length >= PDF_ROW_MIN_ITEMS) {
    const result = rustPDFRowLines(entries)
    if (result !== undefined) return result
  }
  return legacyPDFRowLines(entries, rtl)
}

// Original cold-start/error/small-page path retained verbatim below.

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
