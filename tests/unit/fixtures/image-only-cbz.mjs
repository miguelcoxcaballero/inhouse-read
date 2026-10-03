// Two valid 1px PNG originals plus metadata. Word measurement parses the ZIP
// through Foliate but must not decode/load either page or count metadata text.
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNQSFjwHwAD5AIge4YO3AAAAABJRU5ErkJggg==', 'base64');
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let bit=0;bit<8;bit++) crc=(crc>>>1)^((crc&1)?0xedb88320:0); }
  return (crc ^ 0xffffffff) >>> 0;
}
export function imageOnlyCBZ({ images = true } = {}) {
  const entries = [['ComicInfo.xml', Buffer.from('<ComicInfo><Title>Metadata words are not printed body text</Title></ComicInfo>')],
    ...(images ? [['pages/01.png', png], ['pages/02.png', png]] : [])];
  const local=[], central=[]; let offset=0;
  for (const [path, bytes] of entries) {
    const name=Buffer.from(path), crc=crc32(bytes), header=Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20,4); header.writeUInt32LE(crc,14);
    header.writeUInt32LE(bytes.length,18); header.writeUInt32LE(bytes.length,22); header.writeUInt16LE(name.length,26);
    local.push(header,name,bytes);
    const entry=Buffer.alloc(46); entry.writeUInt32LE(0x02014b50); entry.writeUInt16LE(20,4); entry.writeUInt16LE(20,6);
    entry.writeUInt32LE(crc,16); entry.writeUInt32LE(bytes.length,20); entry.writeUInt32LE(bytes.length,24);
    entry.writeUInt16LE(name.length,28); entry.writeUInt32LE(offset,42);
    central.push(entry,name); offset+=header.length+name.length+bytes.length;
  }
  const directory=Buffer.concat(central), end=Buffer.alloc(22); end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length,8); end.writeUInt16LE(entries.length,10);
  end.writeUInt32LE(directory.length,12); end.writeUInt32LE(offset,16);
  return Buffer.concat([...local,directory,end]);
}
