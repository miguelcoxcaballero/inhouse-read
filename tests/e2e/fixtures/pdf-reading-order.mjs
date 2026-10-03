// A real, untagged PDF whose painting order deliberately differs from reading
// order. Coordinates, not the PDF stream, describe the two columns/paragraphs.
// Bytes are generated in memory like image-theme-pdf.mjs; no parser is mocked.
export const PDF_ORDER_PARAGRAPHS = [
  'Reading order across columns.',
  'The left sentence begins on one line and continues on the next line without a pause. A second sentence stays in the same paragraph.',
  'A wider gap starts a new paragraph. Its second line still belongs here.',
  'Only after the left column comes the right. Every phrase must stay in visual order.',
  'This is the last paragraph on the right. No sentence is skipped or repeated.'
]
export const PDF_ORDER_PAGE_TWO = [
  'A new page starts here.',
  'This sentence crosses a line break and finishes on the line below.',
  'The book ends after this final paragraph.'
]
const FIRST = [
  ['Reading order across columns.', 40, 746, 20],
  ['The left sentence begins on one line and', 40, 690],
  ['continues on the next line without a pause.', 40, 672],
  ['A second sentence stays in the same paragraph.', 40, 654],
  ['A wider gap starts a new paragraph.', 40, 610],
  ['Its second line still belongs here.', 40, 592],
  ['Only after the left column comes the right.', 340, 690],
  ['Every phrase must stay in visual order.', 340, 672],
  ['This is the last paragraph on the right.', 340, 628],
  ['No sentence is skipped or repeated.', 340, 610]
]
const SECOND = [
  ['A new page starts here.', 40, 730],
  ['This sentence crosses a line break and', 40, 680],
  ['finishes on the line below.', 40, 662],
  ['The book ends after this final paragraph.', 40, 610]
]
const escape = text => text.replace(/[()\\]/g, character => '\\' + character)
export function readingOrderPDF() {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [4 0 R 6 0 R] /Count 2 >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'
  ]
  for (const [page, order] of [[FIRST, [9, 3, 7, 4, 0, 6, 2, 8, 5, 1]], [SECOND, [3, 2, 0, 1]]]) {
    const index = objects.length + 1
    const content = order.map(raw => {
      const [text, x, y, size = 12] = page[raw]
      return `BT /F1 ${size} Tf 1 0 0 1 ${x} ${y} Tm (${escape(text)}) Tj ET\n`
    }).join('')
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 640 800] /Resources << /Font << /F1 3 0 R >> >> /Contents ${index + 1} 0 R >>`,
      `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}endstream`)
  }
  let pdf = '%PDF-1.4\n'
  const offsets = []
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${object}\nendobj\n` })
  const xref = Buffer.byteLength(pdf)
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
    + offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')
    + `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(pdf)
}
