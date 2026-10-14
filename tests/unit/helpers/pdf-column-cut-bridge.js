// The host side of the column-cut kernel as it was used by the reading-order code
// before the order kernel (pdf_order_lines) began calling pdf_column_cut itself.
// Production no longer crosses this boundary; the suite keeps it to test the
// kernel's geometry contract, its arena handling and its fallbacks directly.
import { getRustCore } from '../../../src/js/rust-core.js'
import { legacyPDFColumnCut } from './reference-pdf-pipeline.js'

// Most PDF pages contain a single column. If every horizontal interval has a
// common interior, no candidate can put lines on both sides of a gutter.
// Reject that case before copying geometry or allocating a WASM arena.
function sharedHorizontalInterior(lines) {
  let left = -Infinity, right = Infinity
  for (let index = 0; index < lines.length; index++) {
    const { x0, x1 } = lines[index]
    if (!Number.isFinite(x0) || !Number.isFinite(x1) || x0 > x1) return false
    left = Math.max(left, x0); right = Math.min(right, x1)
    if (!(left < right)) return false
  }
  return true
}

// A page's recursive column splits reuse at most 64 KiB. Large exceptional
// pages use a temporary arena; every nested/reentrant call owns another arena.
// There is no await while leased, and no view survives a WASM memory growth.
const MAX_RETAINED_ELEMENTS = 8192
let retained = null
function acquire(core, length) {
  if (retained && retained.core !== core && !retained.inUse) {
    retained.core.free_f64(retained.pointer, retained.length)
    retained = null
  }
  if (retained?.core === core && !retained.inUse && retained.length >= length) {
    retained.inUse = true
    return retained
  }
  const keep = length <= MAX_RETAINED_ELEMENTS && !retained?.inUse
  if (keep && retained) {
    retained.core.free_f64(retained.pointer, retained.length)
    retained = null
  }
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

// undefined means that the CPU kernel is unavailable; null is a valid result.
// Only geometry crosses the boundary. Return the original line objects so the
// PDF.js metadata, text and source offset identities are exactly preserved.
export function rustPDFColumnCut(lines) {
  if (lines.length < 4) return null
  const core = getRustCore()
  if (!core?.pdf_column_cut) return undefined
  if (sharedHorizontalInterior(lines)) return null
  const inputLength = lines.length * 6, length = inputLength + 3
  let arena, failed = false
  try {
    arena = acquire(core, length)
    if (!arena) return undefined
    const { pointer } = arena
    const input = new Float64Array(core.memory.buffer, pointer, inputLength)
    for (let index = 0; index < lines.length; index++) {
      const { x0, x1, top, bottom, y, height } = lines[index]
      if (!Number.isFinite(x0) || !Number.isFinite(x1) || !Number.isFinite(top)
        || !Number.isFinite(bottom) || !Number.isFinite(y) || !Number.isFinite(height)) return undefined
      const offset = index * 6
      input[offset] = x0; input[offset + 1] = x1; input[offset + 2] = top
      input[offset + 3] = bottom; input[offset + 4] = y; input[offset + 5] = height
    }
    core.pdf_column_cut(pointer, lines.length, pointer + inputLength * 8)
    // Vec allocations can grow WASM memory and detach the previous JS view.
    const [kind, at, score] = new Float64Array(core.memory.buffer, pointer + inputLength * 8, 3)
    if (kind === 0) return null
    if (kind === 2) return { table:true }
    if (kind !== 1 || !Number.isFinite(at) || !Number.isFinite(score)) return undefined
    const left = [], right = [], crossing = []
    for (const line of lines) (line.x1 <= at ? left : line.x0 >= at ? right : crossing).push(line)
    return { at, left, right, crossing, score }
  } catch { failed = true; return undefined }
  finally { if (arena) release(arena, failed) }
}


export function pdfColumnCut(lines) {
  const result = rustPDFColumnCut(lines)
  return result === undefined ? legacyPDFColumnCut(lines) : result
}
