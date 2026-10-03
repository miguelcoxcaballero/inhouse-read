import { deflateSync } from 'node:zlib'

function crc32(bytes) {
  let crc=0xffffffff
  for(const byte of bytes) { crc^=byte; for(let bit=0;bit<8;bit++) crc=(crc>>>1)^((crc&1)?0xedb88320:0) }
  return (crc^0xffffffff)>>>0
}
function colourPNG() {
  const header=Buffer.alloc(13);header.writeUInt32BE(4);header.writeUInt32BE(1,4);header[8]=8;header[9]=2
  const chunk=(name,data)=>{
    const type=Buffer.from(name),length=Buffer.alloc(4),crc=Buffer.alloc(4)
    length.writeUInt32BE(data.length);crc.writeUInt32BE(crc32(Buffer.concat([type,data])))
    return Buffer.concat([length,type,data,crc])
  }
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),
    chunk('IDAT',deflateSync(Buffer.from([0,230,35,50,25,190,80,35,70,225,110,110,110]))),chunk('IEND',Buffer.alloc(0))])
}

/** Real EPUB/PNG resources, with no Foliate, image or theme doubles. */
export function imageThemeEPUB() {
  const entries=[
    ['mimetype','application/epub+zip'],
    ['META-INF/container.xml','<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'],
    ['book.opf','<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">image-colours</dc:identifier><dc:title>Original image colours</dc:title><dc:language>en</dc:language><meta property="dcterms:modified">2026-10-03T00:00:00Z</meta></metadata><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/><item id="photo" href="colours.png" media-type="image/png"/><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/></manifest><spine><itemref idref="chapter"/></spine></package>'],
    ['nav.xhtml','<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head><body><nav epub:type="toc"><ol><li><a href="chapter.xhtml">Image colours</a></li></ol></nav></body></html>'],
    ['chapter.xhtml','<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Image colours</title></head><body><h1>Original image colours</h1><p>The printed images keep their original colours.</p><img id="original-colours" src="colours.png" alt="Four original colour and gray swatches" style="width:200px;height:50px;image-rendering:pixelated"/><svg id="original-vector" xmlns="http://www.w3.org/2000/svg" width="200" height="50" viewBox="0 0 200 50"><rect x="0" width="50" height="50" fill="rgb(230,35,50)"/><rect x="50" width="50" height="50" fill="rgb(25,190,80)"/><rect x="100" width="50" height="50" fill="rgb(35,70,225)"/><rect x="150" width="50" height="50" fill="rgb(110,110,110)"/></svg></body></html>'],
    ['colours.png',colourPNG()]
  ]
  const locals=[],central=[];let offset=0
  for(const [path,data] of entries) {
    const name=Buffer.from(path),bytes=Buffer.isBuffer(data)?data:Buffer.from(data),crc=crc32(bytes)
    const header=Buffer.alloc(30);header.writeUInt32LE(0x04034b50);header.writeUInt16LE(20,4)
    header.writeUInt32LE(crc,14);header.writeUInt32LE(bytes.length,18);header.writeUInt32LE(bytes.length,22);header.writeUInt16LE(name.length,26)
    locals.push(header,name,bytes)
    const entry=Buffer.alloc(46);entry.writeUInt32LE(0x02014b50);entry.writeUInt16LE(20,4);entry.writeUInt16LE(20,6)
    entry.writeUInt32LE(crc,16);entry.writeUInt32LE(bytes.length,20);entry.writeUInt32LE(bytes.length,24);entry.writeUInt16LE(name.length,28);entry.writeUInt32LE(offset,42)
    central.push(entry,name);offset+=header.length+name.length+bytes.length
  }
  const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16)
  return Buffer.concat([...locals,directory,end])
}
