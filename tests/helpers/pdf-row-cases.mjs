export const PDF_ROW_BENCH_CASES = [4,32,128,512,1280,4096]
  .flatMap(count => ['paragraphs','fragmented','columns','mixed'].map(kind => ({kind,count})))
const texts = ['A ', 'fragment', 'café ', '日本語', 'مرحبا ', 'עולם', '👩🏽‍💻 ', 'e\u0301', '\u00a0', 'informa\u00ad', 'ción', '𠮷']
export function makePDFRowEntries(kind, count, seed = 0x524f5753) {
  const random = () => { seed = (Math.imul(seed,1664525) + 1013904223) >>> 0; return seed / 4294967296 }
  const entries = []
  for (let index = 0; index < count; index++) {
    const perLine = kind === 'paragraphs' ? 1 : kind === 'columns' ? 8 : 16
    const column = kind === 'columns' ? Math.floor(index / perLine) % 2 : 0
    const row = Math.floor(index / (perLine * (kind === 'columns' ? 2 : 1)))
    const piece = index % perLine
    const height = kind === 'mixed' ? [7,12,12,16,24][Math.floor(random()*5)] : 12
    const x0 = 20 + column * 280 + piece * (kind === 'columns' ? 26 : 19)
    const y = 40 + row * 19 + (kind === 'mixed' ? (random() - .5) * 9 : 0)
    const str = kind === 'mixed' ? texts[Math.floor(random() * texts.length)] : `${row}:${piece} `
    const item = { str, dir:kind === 'mixed' && random() < .48 ? 'rtl' : 'ltr',
      fontName:`source-font-${index % 3}`, hasEOL:index % 3 === 0,
      width:kind === 'paragraphs' ? 480 : kind === 'mixed' ? 8+random()*20 : 17, height,
      transform:[height,0,0,height,x0,800-y], sourceMetadata:{ ordinal:index } }
    entries.push({ item,rawIndex:index,x0,x1:x0+item.width,y,height,top:y-height,bottom:y })
  }
  for (let index = entries.length - 1; index > 0; index--) {
    const next = Math.floor(random() * (index + 1)); [entries[index],entries[next]] = [entries[next],entries[index]]
  }
  return entries
}
export function pdfContentFromEntries(entries) { return { items:entries.map(entry => entry.item),
  styles:{ 'source-font-0':{ fontFamily:'serif',ascent:.8,descent:-.2 } }, lang:null } }
export const PDF_ROW_VIEWPORT = { width:640,height:800,transform:[1,0,0,-1,0,800] }

// Object.is preserves signed zero in geometric parity, unlike JSON.stringify.
// No timing measurement calls this deep structural oracle.
export function assertExactPDFValue(actual, expected, label = 'PDF') {
  if (Object.is(actual, expected)) return
  if (typeof actual !== typeof expected || actual === null || expected === null || typeof actual !== 'object')
    throw new Error(`${label}: scalar differs (${String(actual)} vs ${String(expected)})`)
  if (Array.isArray(actual) !== Array.isArray(expected)) throw new Error(`${label}: array kind differs`)
  const keys = Object.keys(actual), expectedKeys = Object.keys(expected)
  if (keys.length !== expectedKeys.length || keys.some(key => !Object.hasOwn(expected,key))) throw new Error(`${label}: keys differ`)
  for (const key of keys) assertExactPDFValue(actual[key],expected[key],`${label}.${key}`)
}
export function assertPDFRowIdentities(actual, expected) {
  assertExactPDFValue(actual,expected)
  for (let row=0;row<actual.length;row++) for(let piece=0;piece<actual[row].entries.length;piece++)
    if(actual[row].entries[piece]!==expected[row].entries[piece]) throw new Error('Original PDF entry identity changed')
}
export function assertPDFSourceIdentities(layout, content) {
  const indices=[]
  for(const line of layout.lines) for(const entry of line.entries) {
    if(entry.item!==content.items[entry.rawIndex]) throw new Error('Original PDF.js item identity changed')
    indices.push(entry.rawIndex)
  }
  const source=content.items.filter(item=>typeof item.str==='string'&&item.str)
  if(layout.geometric && (indices.length!==source.length || new Set(indices).size!==source.length))
    throw new Error('PDF source item lost or duplicated')
  for(const span of layout.spans) {
    if(layout.text.slice(span.start,span.end)!==content.items[span.rawIndex].str.slice(span.sourceStart,span.sourceEnd))
      throw new Error('UTF-16 source offsets changed')
  }
}
