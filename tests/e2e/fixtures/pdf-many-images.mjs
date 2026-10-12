// One real PDF page with 32 separate uses of the same four-colour image.
export function manyImagesPDF() {
  const hex='e6233219be502346e16e6e6e>';
  const stream='BT /F1 12 Tf 30 775 Td (All thirty-two illustrations retain their original colours.) Tj ET\n'+
    Array.from({length:32},(_,i)=>`q 72 0 0 40 ${20+i%4*96} ${690-Math.floor(i/4)*82} cm /Im1 Do Q\n`).join('');
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [5 0 R] /Count 1 >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Type /XObject /Subtype /Image /Width 4 /Height 1 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /ASCIIHexDecode /Length ${hex.length} >>\nstream\n${hex}\nendstream`,
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 800] /Resources << /Font << /F1 3 0 R >> /XObject << /Im1 4 0 R >> >> /Contents 6 0 R >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}endstream`];
  let pdf='%PDF-1.4\n';const offsets=[];
  for(let i=0;i<objects.length;i++){offsets.push(pdf.length);pdf+=`${i+1} 0 obj\n${objects[i]}\nendobj\n`;}
  const xref=pdf.length;pdf+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`+offsets.map(n=>`${String(n).padStart(10,'0')} 00000 n \n`).join('')+
    `trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}
