// Minimal real PDF: colour/gray image pixels, a rotated photo, black text and
// white paper. No PDF renderer or theme double participates in the test.
export function imageThemePDF() {
  const swatches = [[230,35,50],[25,190,80],[35,70,225],[110,110,110]]
  const hex = swatches.flat().map(value => value.toString(16).padStart(2,'0')).join('') + '>'
  const content = 'BT /F1 20 Tf 40 540 Td (Original image colours) Tj ET\nq 200 0 0 80 40 360 cm /Im1 Do Q\nq 100 50 -25 50 240 190 cm /Im1 Do Q\n'
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 600] /Resources << /Font << /F1 4 0 R >> /XObject << /Im1 5 0 R >> >> /Contents 6 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Type /XObject /Subtype /Image /Width 4 /Height 1 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /ASCIIHexDecode /Length ${hex.length} >>\nstream\n${hex}\nendstream`,
    `<< /Length ${content.length} >>\nstream\n${content}endstream`
  ]
  let pdf = '%PDF-1.4\n', offsets = [0]
  for (let i = 0; i < objects.length; i++) { offsets.push(pdf.length); pdf += `${i+1} 0 obj\n${objects[i]}\nendobj\n` }
  const xref = pdf.length
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  pdf += offsets.slice(1).map(offset => `${String(offset).padStart(10,'0')} 00000 n \n`).join('')
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(pdf)
}
