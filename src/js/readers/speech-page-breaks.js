// Page cuts come from laid-out glyphs, not an estimate of words or audio time.
// Most text nodes occupy one page: only nodes spanning a page need binary
// searches. This keeps chapter preparation cheap on a phone.
export async function speechPageBreaks(map, renderer, { isCurrent = () => true } = {}) {
  const size = Number(renderer?.size)
  if (renderer?.scrolled || !(size > 0) || !Number.isFinite(size)) return []
  const doc = map.spans[0]?.node.ownerDocument
  if (!doc?.body) return []
  const style = doc.defaultView.getComputedStyle(doc.body)
  const rtl = doc.body.dir === 'rtl' || style.direction === 'rtl' || doc.documentElement.dir === 'rtl'
  const vertical = /^vertical-/.test(style.writingMode)
  const total = Number(renderer.pages) * size
  if (rtl && !Number.isFinite(total)) return []
  const pageOf = rect => Math.floor((rtl ? total - rect.right : vertical ? rect.top : rect.left) / size)
  const rectsFor = (start, end) => [...(map.rangeFor(start, end)?.getClientRects() || [])]
    .filter(rect => rect.width > 0 && rect.height > 0)
  const cuts = []
  let previous
  for (let index = 0; index < map.spans.length; index++) {
    if (index && index % 64 === 0) await new Promise(resolve => setTimeout(resolve, 0))
    if (!isCurrent()) return []
    const span = map.spans[index]
    const pages = [...new Set(rectsFor(span.start, span.end).map(pageOf))].sort((a, b) => a - b)
    if (!pages.length) continue
    if (previous !== undefined && pages[0] !== previous) cuts.push(span.start)
    for (const page of pages.slice(1)) {
      let low = span.start, high = span.end
      // A collapsed space at the end of a column has no box. Look forward to
      // the next visible glyph, so the cut belongs to its spoken text.
      const glyphPage = offset => {
        while (offset < span.end && /\s/.test(map.text[offset])) offset++
        if (offset >= span.end) return pages.at(-1)
        const length = map.text.codePointAt(offset) > 0xffff ? 2 : 1
        const rect = rectsFor(offset, Math.min(span.end, offset + length))[0]
        return rect ? pageOf(rect) : pages[0]
      }
      while (low < high) {
        const mid = (low + high) >>> 1
        if (glyphPage(mid) < page) low = mid + 1
        else high = mid
      }
      // Never divide a UTF-16 surrogate pair.
      if (low > span.start && /[\uDC00-\uDFFF]/.test(map.text[low])) low--
      if (low > span.start && low < span.end) cuts.push(low)
    }
    previous = pages.at(-1)
  }
  return [...new Set(cuts)].sort((a, b) => a - b)
}
