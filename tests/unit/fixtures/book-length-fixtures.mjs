/** Real untagged PDF bytes. Page layout deliberately varies independently of
 * the exact text volume. No PDF.js, text extraction or engine doubles. */
export function wordVolumePDF({ words = 30_000, pages = 3 } = {}) {
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${Array.from({length:pages},(_,i)=>`${4+i*2} 0 R`).join(' ')}] /Count ${pages} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'];
  for (let index=0; index<pages; index++) {
    const count = Math.floor(words/pages) + (index < words%pages ? 1 : 0);
    // All glyphs stay inside the MediaBox. PDF.js correctly omits text painted
    // beyond it, so an infinitely long off-page line would be a bad fixture.
    const rows=Math.ceil(count/100),leading=660/(rows+1);
    const content=Array.from({length:rows},(_,row)=>
      `BT /F1 0.8 Tf 1 0 0 1 30 ${730-row*leading} Tm (${'word '.repeat(Math.min(100,count-row*100)).trim()}) Tj ET\n`).join('');
    const number = objects.length+1;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 640 800] /Resources << /Font << /F1 3 0 R >> >> /Contents ${number+1} 0 R >>`,
      `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}endstream`);
  }
  let pdf='%PDF-1.4\n'; const offsets=[];
  objects.forEach((object,index)=>{offsets.push(Buffer.byteLength(pdf));pdf+=`${index+1} 0 obj\n${object}\nendobj\n`;});
  const xref=Buffer.byteLength(pdf);
  pdf+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`
    +offsets.map(offset=>`${String(offset).padStart(10,'0')} 00000 n \n`).join('')
    +`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}

function crc32(bytes) {
  let crc=0xffffffff;
  for (const byte of bytes) { crc^=byte; for(let bit=0;bit<8;bit++) crc=(crc>>>1)^((crc&1)?0xedb88320:0); }
  return (crc^0xffffffff)>>>0;
}

/** Four actual spine documents, the last marked non-linear. */
export function wordVolumeEPUB() {
  const texts=['One two three.','Four five six seven eight nine.',
    'Ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen.',
    'Twenty twentyone twentytwo twentythree.'];
  const entries=[['mimetype','application/epub+zip'],
    ['META-INF/container.xml','<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'],
    ['book.opf',`<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">word-volume</dc:identifier><dc:title>Word volume</dc:title><dc:language>en</dc:language><meta property="dcterms:modified">2026-10-03T00:00:00Z</meta></metadata><manifest>${texts.map((_,i)=>`<item id="c${i}" href="c${i}.xhtml" media-type="application/xhtml+xml"/>`).join('')}<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/></manifest><spine>${texts.map((_,i)=>`<itemref idref="c${i}"${i===3?' linear="no"':''}/>`).join('')}</spine></package>`],
    ['nav.xhtml','<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head><body><nav epub:type="toc"><ol><li><a href="c0.xhtml">First</a></li></ol></nav></body></html>'],
    ...texts.map((text,i)=>[`c${i}.xhtml`,`<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Excluded metadata ${i}</title></head><body><p>${text}</p></body></html>`])];
  const locals=[],central=[];let offset=0;
  for(const [path,data] of entries) {
    const name=Buffer.from(path),bytes=Buffer.from(data),crc=crc32(bytes),header=Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50);header.writeUInt16LE(20,4);header.writeUInt32LE(crc,14);
    header.writeUInt32LE(bytes.length,18);header.writeUInt32LE(bytes.length,22);header.writeUInt16LE(name.length,26);
    locals.push(header,name,bytes);
    const entry=Buffer.alloc(46);entry.writeUInt32LE(0x02014b50);entry.writeUInt16LE(20,4);entry.writeUInt16LE(20,6);
    entry.writeUInt32LE(crc,16);entry.writeUInt32LE(bytes.length,20);entry.writeUInt32LE(bytes.length,24);
    entry.writeUInt16LE(name.length,28);entry.writeUInt32LE(offset,42);
    central.push(entry,name);offset+=header.length+name.length+bytes.length;
  }
  const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);
  end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...locals,directory,end]);
}
