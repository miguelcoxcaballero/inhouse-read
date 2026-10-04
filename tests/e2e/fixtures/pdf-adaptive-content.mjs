export const ADAPTIVE_PARAGRAPHS=[
  'A sentence starts on this line and continues in larger type before returning to ordinary text.',
  Array.from({length:18},(_,i)=>`Complete marker ${String(i).padStart(2,'0')} stays readable.`).join(' ')
]
export const ADAPTIVE_SECOND='Text after the next photograph remains readable. No phrase should disappear.'

// Real image XObjects and mixed body-font metrics. Page three is an image-only
// scan, and painting order deliberately differs from geometric reading order.
export function adaptiveContentPDF() {
  const colors=[[230,35,50],[25,190,80],[35,70,225],[110,110,110]]
  const hex=colors.flat().map(n=>n.toString(16).padStart(2,'0')).join('')+'>'
  const escape=text=>text.replace(/[()\\]/g,c=>'\\'+c)
  const line=(text,y,size=12)=>`BT /F1 ${size} Tf 1 0 0 1 40 ${800-y} Tm (${escape(text)}) Tj ET\n`
  const first=[line('A sentence starts on this line and',65),line('continues in larger type before',83,17),
    line('returning to ordinary text.',101),...Array.from({length:18},(_,i)=>line(`Complete marker ${String(i).padStart(2,'0')} stays readable.`,340+i*18,i%2?17:12))]
  const streams=[
    first.filter((_,i)=>i%2).reverse().concat(first.filter((_,i)=>!(i%2))).join('')+
      'q 240 0 0 90 40 510 cm /Im1 Do Q\nq 80 40 -20 40 310 560 cm /Im1 Do Q\n',
    'q 240 0 0 120 40 600 cm /Im1 Do Q\n'+line('Text after the next photograph remains readable.',260)+line('No phrase should disappear.',278),
    'q 400 0 0 800 0 0 cm /Im1 Do Q\n'
  ]
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [5 0 R 7 0 R 9 0 R] /Count 3 >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    `<< /Type /XObject /Subtype /Image /Width 4 /Height 1 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /ASCIIHexDecode /Length ${hex.length} >>\nstream\n${hex}\nendstream`]
  for (const stream of streams) {
    const index=objects.length+1
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 800] /Resources << /Font << /F1 3 0 R >> /XObject << /Im1 4 0 R >> >> /Contents ${index+1} 0 R >>`,
      `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`)
  }
  let pdf='%PDF-1.4\n',offsets=[]
  objects.forEach((object,i)=>{offsets.push(Buffer.byteLength(pdf));pdf+=`${i+1} 0 obj\n${object}\nendobj\n`})
  const xref=Buffer.byteLength(pdf)
  pdf+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`+offsets.map(n=>`${String(n).padStart(10,'0')} 00000 n \n`).join('')+
    `trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(pdf)
}
