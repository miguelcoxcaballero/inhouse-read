// Real two-page PDF. Its 32 short printed lines become multiple screens on a phone.
const escape = text => text.replace(/[()\\]/g, character => '\\' + character)
export const PDF_REFLOW_SENTENCES = Array.from({ length:32 }, (_,i) => `Sentence ${String(i+1).padStart(2,'0')} starts here and ends with marker${String(i+1).padStart(2,'0')}.`)
export function longReflowPDF() {
 const objects = ['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [4 0 R 6 0 R] /Count 2 >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>']
 for(const lines of [PDF_REFLOW_SENTENCES,['The second physical page starts here. Its unique marker is next-page.']]) {
  const n=objects.length+1
  const content=lines.map((line,i)=>`BT /F1 11 Tf 1 0 0 1 45 ${745-i*21} Tm (${escape(line)}) Tj ET\n`).join('')
  objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${n+1} 0 R >>`,`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}endstream`)
 }
 let pdf='%PDF-1.4\n';const offsets=[]
 for(const [i,object] of objects.entries()){offsets.push(Buffer.byteLength(pdf));pdf+=`${i+1} 0 obj\n${object}\nendobj\n`}
 const xref=Buffer.byteLength(pdf);pdf+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`+offsets.map(x=>`${String(x).padStart(10,'0')} 00000 n \n`).join('')+`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
 return Buffer.from(pdf)
}
