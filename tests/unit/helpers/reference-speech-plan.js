import {normalizeSpeech,speechSentences} from './reference-speech-text.js'
export function planSpeech(raw, options = {}, from = 0) {
  const { text, map, breaks } = normalizeSpeech(raw, options)
  let low = 0, high = map.length
  while (low < high) { const mid = (low + high) >> 1; if (map[mid] < from) low = mid + 1; else high = mid }
  const rawRange = (start, end) => ({ start:map[low + start], end:map[low + end - 1] + 1 })
  const pageCuts = [...new Set((options.pageBreaks || []).filter(Number.isFinite).map(offset => {
    let a = low, b = map.length
    while (a < b) { const mid = (a + b) >>> 1; if (map[mid] < offset) a = mid + 1; else b = mid }
    // A column may begin with the space after the previous line. Following
    // that space still selects the previous page; mark the first spoken glyph.
    while (a < text.length && /\s/.test(text[a])) a++
    return a - low
  }))].sort((a, b) => a - b)
  const items = []
  for (const sentence of speechSentences(text.slice(low), breaks.filter(at => at >= low).map(at => at - low))) {
    const whole = rawRange(sentence.start, sentence.end)
    for (const fragment of sentence.fragments) {
      // Start a long opening sentence at its first natural clause. Both parts
      // retain their original sentence/raw offsets, including page boundaries.
      // No arbitrary word cuts or punctuation are invented to fake a quick start.
      const firstClause = options.opening && !items.length && fragment.end - fragment.start > 100
        ? [...fragment.text.matchAll(/[,;:—–،、，；：](?:\s+|(?=[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]))/gu)]
          .map(m => fragment.start + m.index + m[0].length)
          .find(at => at - fragment.start >= 24 && at - fragment.start <= 90 && fragment.end - at >= 24)
        : undefined
      const cuts = [...new Set([fragment.start,
        ...(firstClause == null ? [] : [firstClause]), fragment.end])].sort((a,b) => a-b)
      for (let index = 1; index < cuts.length; index++) {
        let start = cuts[index - 1], end = cuts[index]
        while (start < end && /\s/.test(text[low + start])) start++
        while (end > start && /\s/.test(text[low + end - 1])) end--
        if (end > start) {
          const marks = pageCuts.filter(at => at > start && at < end).map(at => ({offset:at-start,start:map[low+at]}))
          items.push({ text:text.slice(low + start, low + end), ...rawRange(start, end), sentence:whole, ...(marks.length ? {marks} : {}) })
        }
      }
    }
  }
  return items
}
