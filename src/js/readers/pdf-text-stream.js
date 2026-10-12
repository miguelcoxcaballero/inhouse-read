import {rustPDFTextStream} from './pdf-stream-wasm.js';
const median = values => {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

const cjk = char => /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(char || '')
const listStart = text => /^(?:[•●▪‣⁃]|\d{1,3}[.)]|[a-z][.)])\s/u.test(text.trimStart())
function fragmentSeparator(previous, next, rtl) {
  const a = previous.item.str, b = next.item.str
  if (/\s$/.test(a) || /^\s/.test(b) || cjk(a.at(-1)) && cjk(b[0])) return ''
  const gap = rtl ? previous.x0 - next.x1 : next.x0 - previous.x1
  return gap <= Math.min(previous.height, next.height) * .12 ? '' : ' '
}

export function legacyPDFTextStream(lines) {
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

export function assemblePDFLines(lines) {
  const count=lines.reduce((sum,line)=>sum+line.entries.length,0);
  return (count>=128?rustPDFTextStream(lines):undefined)??legacyPDFTextStream(lines);
}
