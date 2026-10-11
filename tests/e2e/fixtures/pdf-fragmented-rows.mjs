// A complete real two-page PDF. Alternating real fonts prevents PDF.js from
// coalescing every separately painted word into one TextContent item. Reverse
// painting order exercises row grouping; the original PDF parser is used.
export function fragmentedRowsPDF() {
  const encode = value => new TextEncoder().encode(value)
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [6 0 R 8 0 R] /Count 2 >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Courier-Bold /Encoding /WinAnsiEncoding >>',
    '<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /ASCIIHexDecode /Length 7 >>\nstream\nE65B39>\nendstream'
  ]
  for (let page=0;page<2;page++) {
    const fragments=[]
    for(let row=0;row<16;row++) for(let column=0;column<2;column++) for(let word=0;word<6;word++) {
      const text=`${column?'R':'L'}${String(row).padStart(2,'0')}${String.fromCharCode(97+word)} `
      const x=40+column*300+word*36, y=710-row*18-(row>=8?36:0)
      fragments.push(`BT /F${1+(word%2)} 10 Tf 1 0 0 1 ${x} ${y} Tm (${text}) Tj ET\n`)
    }
    const content=`q 64 0 0 28 280 370 cm /Im1 Do Q\n`+fragments.reverse().join('')
    const number=objects.length+1
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 640 800] ${page?' /Rotate 90':''} /Resources << /Font << /F1 3 0 R /F2 4 0 R >> /XObject << /Im1 5 0 R >> >> /Contents ${number+1} 0 R >>`,
      `<< /Length ${encode(content).length} >>\nstream\n${content}endstream`)
  }
  let pdf='%PDF-1.4\n'; const offsets=[]
  objects.forEach((object,index)=>{offsets.push(encode(pdf).length);pdf+=`${index+1} 0 obj\n${object}\nendobj\n`})
  const xref=encode(pdf).length
  pdf+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`+offsets.map(offset=>`${String(offset).padStart(10,'0')} 00000 n \n`).join('')
    +`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return encode(pdf)
}
